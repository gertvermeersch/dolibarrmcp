import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { Caller, log, logError, runWithCaller } from "./log.js";
import { registerTools } from "./server.js";

// CORS preflight requests may ask for custom MCP headers. Fall back to the known
// header list when a client does not explicitly send Access-Control-Request-Headers.
const defaultAllowedCorsHeaders = [
  "Accept",
  "Authorization",
  "Content-Type",
  "Last-Event-ID",
  "mcp-protocol-version",
  "mcp-session-id",
  "x-api-key",
  "x-custom-auth-headers",
].join(", ");

// These headers keep browser-based MCP clients happy while exposing the MCP
// session metadata they need to continue a Streamable HTTP session.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": [
    "mcp-protocol-version",
    "mcp-session-id",
  ].join(", "),
};

// Active Streamable HTTP transports, keyed by MCP session id. A transport owns
// the request/response lifecycle for its session until the client disconnects.
const transports = new Map<string, StreamableHTTPServerTransport>();

// MCP clientInfo (name/version) announced at initialize, keyed by session id, so
// later requests in the same session can still be attributed to a client.
const sessionClients = new Map<string, string>();

function clientInfoFromInitialize(body: unknown): string | undefined {
  for (const message of jsonRpcMessages(body)) {
    if (message.method !== "initialize") continue;
    const params = message.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined;
    const info = params?.clientInfo;
    if (typeof info?.name !== "string") continue;
    return typeof info.version === "string" ? `${info.name}/${info.version}` : info.name;
  }
  return undefined;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// Behind a reverse proxy the socket peer is the proxy, so prefer the address it
// forwards. Proxies differ in which header they set, hence the fallbacks. These
// headers are client-controlled, which is fine for log attribution only.
function forwardedClientIp(req: IncomingMessage): string | undefined {
  const xff = headerValue(req, "x-forwarded-for")?.split(",")[0].trim();
  if (xff) return xff;

  const realIp = headerValue(req, "x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = /for="?\[?([^;,"\]\s]+)/i.exec(headerValue(req, "forwarded") ?? "");
  return forwardedFor?.[1];
}

function callerFromRequest(req: IncomingMessage, client?: string): Caller {
  const peer = req.socket.remoteAddress;
  const forwardedIp = forwardedClientIp(req);

  return {
    userAgent: req.headers["user-agent"],
    client,
    ip: forwardedIp ?? peer,
    // Only shown when a forwarded address replaced the socket peer.
    via: forwardedIp && forwardedIp !== peer ? peer : undefined,
  };
}

function jsonRpcMessages(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body.filter((message): message is Record<string, unknown> => (
      Boolean(message) && typeof message === "object"
    ));
  }

  if (body && typeof body === "object") {
    return [body as Record<string, unknown>];
  }

  return [];
}

function logMcpRequest(req: IncomingMessage, body: unknown, sessionId?: string): void {
  const messages = jsonRpcMessages(body);
  const toolCalls = messages
    .filter((message) => message.method === "tools/call")
    .map((message) => {
      const params = message.params;
      if (!params || typeof params !== "object" || !("name" in params)) return "unknown";
      return String(params.name);
    });

  if (toolCalls.length > 0) {
    log("[mcp] tool_call", {
      tools: toolCalls,
      sessionId,
    });
    return;
  }

  const methods = messages
    .map((message) => message.method)
    .filter((method): method is string => typeof method === "string");

  if (methods.length > 0) {
    log("[mcp] request", {
      method: req.method,
      methods,
      sessionId,
    });
  }
}

// Accept the shared key either as `X-API-Key: <key>` or, for clients such as
// OpenWork that only speak standard HTTP auth, as `Authorization: Bearer <key>`.
function extractApiKey(req: IncomingMessage): string | undefined {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey) return apiKey;

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  return match?.[1].trim();
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "dolibarr-mcp",
    version: "0.1.0",
  });

  registerTools(server);
  return server;
}

async function createTransport(client?: string): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (newSessionId) => {
      transports.set(newSessionId, transport);
      if (client) sessionClients.set(newSessionId, client);
    },
  });

  // Drop closed sessions so reconnects do not leak transports over time.
  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
      sessionClients.delete(transport.sessionId);
    }
  };

  const server = createMcpServer();
  await server.connect(transport);

  return transport;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  // Node's IncomingMessage is an async iterable, so collect the body chunks
  // before parsing the JSON-RPC request payload.
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  // MCP uses JSON-RPC errors even when the surrounding HTTP status is non-200.
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  }));
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Apply CORS headers to every response, including errors and preflight replies.
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ?? defaultAllowedCorsHeaders,
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Gate all MCP traffic behind a simple shared API key before doing session work.
  if (extractApiKey(req) !== config.mcpApiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Mutable so the client name can be filled in once an initialize body is parsed.
  const caller = callerFromRequest(req);

  await runWithCaller(caller, async () => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      const sessionIdValue = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      let transport = sessionIdValue ? transports.get(sessionIdValue) : undefined;
      let body: unknown;
      caller.client = sessionIdValue ? sessionClients.get(sessionIdValue) : undefined;

      if (req.method === "POST") {
        body = await readJsonBody(req);
        const initClient = clientInfoFromInitialize(body);
        if (initClient) caller.client = initClient;
        logMcpRequest(req, body, sessionIdValue);
      }

      const isInitializationRequest = req.method === "POST" && isInitializeRequest(body);

      // An initialize request starts a fresh MCP lifecycle. Some browser clients,
      // including the MCP inspector, may keep sending the previous mcp-session-id
      // when reconnecting after a dev-server reload. Reusing that transport would
      // make the SDK reject the request as "Server already initialized", so replace
      // the old session and let the initialize response publish the new session id.
      if (isInitializationRequest) {
        if (transport) {
          if (sessionIdValue) {
            transports.delete(sessionIdValue);
            sessionClients.delete(sessionIdValue);
          }
          await transport.close();
        }

        transport = await createTransport(caller.client);
      }

      // Later requests must carry the mcp-session-id returned by initialization.
      if (!transport) {
        writeJsonRpcError(res, 400, -32000, "Bad Request: Server not initialized");
        return;
      }

      await transport.handleRequest(req, res, body);
    } catch (err) {
      logError("Error handling MCP request:", err);
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });
});

httpServer.listen(config.httpPort, config.httpHost, () => {
  log("dolibarr-mcp started", {
    listen: `${config.httpHost}:${config.httpPort}`,
    dolibarrUrl: config.dolibarrUrl,
    dolibarrRequestTimeoutMs: config.dolibarrRequestTimeoutMs,
    dolibarrDebug: config.dolibarrDebug,
  });
});

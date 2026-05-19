import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { registerTools } from "./server.js";

// CORS preflight requests may ask for custom MCP headers. Fall back to the known
// header list when a client does not explicitly send Access-Control-Request-Headers.
const defaultAllowedCorsHeaders = [
  "Accept",
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

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "dolibarr-mcp",
    version: "0.1.0",
  });

  registerTools(server);
  return server;
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
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== config.mcpApiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  try {
    const sessionId = req.headers["mcp-session-id"];
    const sessionIdValue = Array.isArray(sessionId) ? sessionId[0] : sessionId;
    let transport = sessionIdValue ? transports.get(sessionIdValue) : undefined;
    let body: unknown;

    if (req.method === "POST") {
      body = await readJsonBody(req);
    }

    // A new transport can only be created from an MCP initialize request. All
    // later requests must carry the mcp-session-id returned by that transport.
    if (!transport) {
      if (req.method !== "POST" || !isInitializeRequest(body)) {
        writeJsonRpcError(res, 400, -32000, "Bad Request: Server not initialized");
        return;
      }

      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, newTransport);
        },
      });
      transport = newTransport;

      // Drop closed sessions so reconnects do not leak transports over time.
      newTransport.onclose = () => {
        if (newTransport.sessionId) {
          transports.delete(newTransport.sessionId);
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      writeJsonRpcError(res, 500, -32603, "Internal server error");
    }
  }
});

httpServer.listen(config.httpPort, config.httpHost, () => {
  console.log(`dolibarr-mcp listening on ${config.httpHost}:${config.httpPort}`);
});

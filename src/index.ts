import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { registerTools } from "./server.js";

const server = new McpServer({
  name: "dolibarr-mcp",
  version: "0.1.0",
});

registerTools(server);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

await server.connect(transport);

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Validate API key
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== config.mcpApiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  await transport.handleRequest(req, res);
});

httpServer.listen(config.httpPort, config.httpHost, () => {
  console.log(`dolibarr-mcp listening on ${config.httpHost}:${config.httpPort}`);
});

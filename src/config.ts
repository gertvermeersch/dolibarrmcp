const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

// Centralized runtime configuration. Required values fail fast on startup so the
// MCP server never starts without the credentials it needs to reach Dolibarr.
export const config = {
  mcpApiKey: required("MCP_API_KEY"),
  dolibarrUrl: required("DOLIBARR_URL"),
  dolibarrApiKey: required("DOLIBARR_API_KEY"),

  // Bind to all interfaces by default for Docker/container use; override these
  // for local-only development or when another service owns the default port.
  httpHost: process.env.MCP_HTTP_HOST ?? "0.0.0.0",
  httpPort: parseInt(process.env.MCP_HTTP_PORT ?? "3000", 10),
};

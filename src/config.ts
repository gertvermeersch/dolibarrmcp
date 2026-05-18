const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const config = {
  mcpApiKey: required("MCP_API_KEY"),
  dolibarrUrl: required("DOLIBARR_URL"),
  dolibarrApiKey: required("DOLIBARR_API_KEY"),
  httpHost: process.env.MCP_HTTP_HOST ?? "0.0.0.0",
  httpPort: parseInt(process.env.MCP_HTTP_PORT ?? "3000", 10),
};

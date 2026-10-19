const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const optionalBoolean = (key: string): boolean => {
  const value = process.env[key]?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
};

const optionalPositiveInteger = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (!value) return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: expected a positive integer`);
  }

  return parsed;
};

const optionalPositiveIntegerValue = (key: string): number | undefined => {
  const value = process.env[key];
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: expected a positive integer`);
  }

  return parsed;
};

// Centralized runtime configuration. Required values fail fast on startup so the
// MCP server never starts without the credentials it needs to reach Dolibarr.
export const config = {
  mcpApiKey: required("MCP_API_KEY"),
  dolibarrUrl: required("DOLIBARR_URL"),
  dolibarrApiKey: required("DOLIBARR_API_KEY"),
  dolibarrDebug: optionalBoolean("DOLIBARR_DEBUG"),
  dolibarrRequestTimeoutMs: optionalPositiveInteger("DOLIBARR_REQUEST_TIMEOUT_MS", 30_000),
  dolibarrDefaultWarehouseId: optionalPositiveIntegerValue("DOLIBARR_DEFAULT_WAREHOUSE_ID"),
  // Dolibarr user recorded as signing/follow-up representative on new contracts.
  // Without it, create_contract uses the API user.
  dolibarrDefaultCommercialId: optionalPositiveIntegerValue("DOLIBARR_DEFAULT_COMMERCIAL_ID"),
  mcpAllowDeletes: optionalBoolean("MCP_ALLOW_DELETES"),

  // Bind to all interfaces by default for Docker/container use; override these
  // for local-only development or when another service owns the default port.
  httpHost: process.env.MCP_HTTP_HOST ?? "0.0.0.0",
  httpPort: parseInt(process.env.MCP_HTTP_PORT ?? "3000", 10),
};

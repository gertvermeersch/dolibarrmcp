import { config } from "../config.js";
import type { McpError } from "../types/tools.js";

export class DolibarrApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "DolibarrApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${config.dolibarrUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "DOLAPIKEY": config.dolibarrApiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new DolibarrApiError(res.status, `Dolibarr API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export const dolibarr = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
};

// Converts a DolibarrApiError into a structured McpError for tool responses
export function toApiError(err: unknown): McpError {
  const message =
    err instanceof DolibarrApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Unknown error";
  return { error: "DOLIBARR_API_ERROR", message };
}

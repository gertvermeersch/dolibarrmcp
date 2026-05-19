import { config } from "../config.js";
import type { McpError } from "../types/tools.js";

export class DolibarrApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public path: string,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = "DolibarrApiError";
  }
}

function parseJsonMaybe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
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
    throw new DolibarrApiError(
      res.status,
      `Dolibarr API error ${res.status}: ${text}`,
      path,
      parseJsonMaybe(text),
    );
  }

  return res.json() as Promise<T>;
}

export const dolibarr = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
};

function getDolibarrErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = "error" in body ? body.error : undefined;
  if (!error || typeof error !== "object") return undefined;
  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" ? message : undefined;
}

function moduleHintForPath(path: string): { name: string; action: string } | undefined {
  if (path.startsWith("/products")) {
    return {
      name: "Products/Services",
      action: "Enable the Dolibarr Products/Services API module and grant the API user read access to products/services. Services are exposed by Dolibarr through the products API with mode=2.",
    };
  }
  if (path.startsWith("/thirdparties")) {
    return {
      name: "Third parties",
      action: "Enable the Dolibarr Third parties module and grant the API user read/write access required by this tool.",
    };
  }
  if (path.startsWith("/invoices")) {
    return {
      name: "Invoices",
      action: "Enable the Dolibarr Invoices module and grant the API user invoice permissions required by this tool.",
    };
  }
  if (path.startsWith("/fourn/invoices") || path.startsWith("/fourn/factures")) {
    return {
      name: "Supplier invoices",
      action: "Enable the Dolibarr Supplier invoices module and grant the API user supplier invoice permissions required by this tool.",
    };
  }
  if (path.startsWith("/proposals")) {
    return {
      name: "Commercial proposals",
      action: "Enable the Dolibarr Commercial proposals module and grant the API user proposal permissions required by this tool.",
    };
  }
  return undefined;
}

// Converts a DolibarrApiError into a structured McpError for tool responses
export function toApiError(err: unknown): McpError {
  if (err instanceof DolibarrApiError && err.status === 403) {
    const dolibarrMessage = getDolibarrErrorMessage(err.responseBody);
    const hint = moduleHintForPath(err.path);

    if (dolibarrMessage === "Forbidden" && hint) {
      return {
        error: "DOLIBARR_MODULE_UNAVAILABLE",
        message: `Dolibarr refused access to the ${hint.name} API. The module may be inactive or the API user may be missing permissions.`,
        action: hint.action,
      };
    }
  }

  const message =
    err instanceof DolibarrApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Unknown error";
  return { error: "DOLIBARR_API_ERROR", message };
}

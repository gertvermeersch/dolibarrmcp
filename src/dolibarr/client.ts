import { STATUS_CODES } from "node:http";
import { config } from "../config.js";
import type { McpError } from "../types/tools.js";

const debugBodyLimit = 4000;

export type DolibarrRequestOptions = {
  suppressErrorStatuses?: number[];
};

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

function truncateDebugText(text: string): string {
  if (text.length <= debugBodyLimit) return text;
  return `${text.slice(0, debugBodyLimit)}... [truncated ${text.length - debugBodyLimit} chars]`;
}

function debugPayloadFromText(text: string): unknown {
  if (!text) return undefined;
  const parsed = parseJsonMaybe(text);
  return parsed === undefined ? truncateDebugText(text) : parsed;
}

function logDolibarrRequest(method: string, path: string, url: string, bodyText?: string): void {
  if (!config.dolibarrDebug) return;

  console.log("[dolibarr] ->", `${method} ${path}`, {
    url,
    body: bodyText === undefined ? undefined : debugPayloadFromText(bodyText),
  });
}

function logDolibarrResponse(
  method: string,
  path: string,
  status: number,
  statusText: string,
  durationMs: number,
  text: string,
  options: DolibarrRequestOptions = {},
): void {
  const suppressErrorLog = status >= 400 && options.suppressErrorStatuses?.includes(status);
  if (suppressErrorLog && !config.dolibarrDebug) return;

  if (!config.dolibarrDebug && status < 400) return;

  const log = status >= 400 && !suppressErrorLog ? console.error : console.log;
  log("[dolibarr] <-", `${method} ${path}`, {
    status,
    statusText,
    durationMs: Math.round(durationMs),
    body: debugPayloadFromText(text),
  });
}

function logDolibarrFetchError(
  method: string,
  path: string,
  durationMs: number,
  err: unknown,
): void {
  console.error("[dolibarr] !!", `${method} ${path}`, {
    durationMs: Math.round(durationMs),
    error: err instanceof Error ? err.message : err,
  });
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: DolibarrRequestOptions = {},
): Promise<T> {
  const url = `${config.dolibarrUrl}${path}`;
  const bodyText = body !== undefined ? JSON.stringify(body) : undefined;
  const start = performance.now();
  logDolibarrRequest(method, path, url, bodyText);

  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.dolibarrRequestTimeoutMs);
  try {
    res = await fetch(url, {
      method,
      headers: {
        "DOLAPIKEY": config.dolibarrApiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: bodyText,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    logDolibarrFetchError(method, path, performance.now() - start, err);
    if (controller.signal.aborted) {
      throw new DolibarrApiError(
        408,
        `Dolibarr API request timed out after ${config.dolibarrRequestTimeoutMs}ms`,
        path,
      );
    }
    throw err;
  }

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    logDolibarrFetchError(method, path, performance.now() - start, err);
    if (controller.signal.aborted) {
      throw new DolibarrApiError(
        408,
        `Dolibarr API request timed out after ${config.dolibarrRequestTimeoutMs}ms`,
        path,
      );
    }
    text = res.statusText;
  } finally {
    clearTimeout(timeout);
  }

  logDolibarrResponse(method, path, res.status, res.statusText, performance.now() - start, text, options);

  if (!res.ok) {
    throw new DolibarrApiError(
      res.status,
      `Dolibarr API error ${res.status}: ${text}`,
      path,
      parseJsonMaybe(text),
    );
  }

  if (!text) return undefined as T;

  const parsed = parseJsonMaybe(text);
  return (parsed === undefined ? text : parsed) as T;
}

export const dolibarr = {
  get: <T>(path: string, options?: DolibarrRequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body: unknown, options?: DolibarrRequestOptions) => request<T>("POST", path, body, options),
  put: <T>(path: string, body: unknown, options?: DolibarrRequestOptions) => request<T>("PUT", path, body, options),
  delete: <T>(path: string, options?: DolibarrRequestOptions) => request<T>("DELETE", path, undefined, options),
};

export function isDolibarrNotFoundError(err: unknown): boolean {
  return err instanceof DolibarrApiError && err.status === 404;
}

function getDolibarrErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = "error" in body ? body.error : undefined;
  if (!error || typeof error !== "object") return undefined;
  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" ? message : undefined;
}

function notFoundMessageForPath(path: string): string | undefined {
  const match = /^\/(invoices|supplierinvoices|proposals|thirdparties)\/(\d+)(?:\/|$|\?)/.exec(path);
  if (!match) return undefined;

  const [, resource, id] = match;
  const entity: Record<string, string> = {
    invoices: "Invoice",
    supplierinvoices: "Supplier invoice",
    proposals: "Proposal",
    thirdparties: "Thirdparty",
  };

  return `${entity[resource]} ${id} not found.`;
}

function cleanDolibarrErrorMessage(err: DolibarrApiError): string {
  const dolibarrMessage = getDolibarrErrorMessage(err.responseBody);
  const statusText = STATUS_CODES[err.status] ?? "Error";
  return dolibarrMessage
    ? `Dolibarr API error ${err.status}: ${dolibarrMessage}`
    : `Dolibarr API error ${err.status}: ${statusText}`;
}

export type ApiErrorContext = {
  supplierInvoiceRef?: string;
};

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
  if (path.startsWith("/supplierinvoices")) {
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
  if (path.startsWith("/orders")) {
    return {
      name: "Customer orders",
      action: "Enable the Dolibarr Customer orders module and grant the API user order permissions required by this tool.",
    };
  }
  return undefined;
}

// Converts a DolibarrApiError into a structured McpError for tool responses
export function toApiError(
  err: unknown,
  context: ApiErrorContext = {},
): McpError | Record<string, unknown> {
  if (err instanceof DolibarrApiError) {
    const dolibarrMessage = getDolibarrErrorMessage(err.responseBody);

    if (err.status === 404) {
      return {
        error: "NOT_FOUND",
        message: notFoundMessageForPath(err.path) ?? "The requested Dolibarr record was not found.",
      };
    }

    if (err.status === 304 && /\/validate$/.test(err.path)) {
      return {
        success: true,
        status: "validated",
        note: "Already validated.",
      };
    }

    if (dolibarrMessage === "ErrorBadThirdPartyName") {
      return {
        error: "VALIDATION_ERROR",
        message: "Thirdparty name is required.",
      };
    }

    if (dolibarrMessage === "ErrorRefAlreadyExists") {
      return {
        error: "DUPLICATE_REF",
        message: context.supplierInvoiceRef
          ? `Supplier invoice ref '${context.supplierInvoiceRef}' already exists for this supplier.`
          : "Supplier invoice ref already exists for this supplier.",
      };
    }

    if (err.status === 403) {
      const hint = moduleHintForPath(err.path);

      if (dolibarrMessage === "Forbidden" && hint) {
        return {
          error: "DOLIBARR_MODULE_UNAVAILABLE",
          message: `Dolibarr refused access to the ${hint.name} API. The module may be inactive or the API user may be missing permissions.`,
          action: hint.action,
        };
      }
    }
  }

  const message =
    err instanceof DolibarrApiError
      ? cleanDolibarrErrorMessage(err)
      : err instanceof Error
        ? err.message
        : "Unknown error";
  return { error: "DOLIBARR_API_ERROR", message };
}

import { config } from "../config.js";
import { log, logError } from "../log.js";
import { DolibarrApiError } from "./errors.js";

const debugBodyLimit = 4000;

export type DolibarrRequestOptions = {
  suppressErrorStatuses?: number[];
};

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

  log("[dolibarr] ->", `${method} ${path}`, {
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

  const write = status >= 400 && !suppressErrorLog ? logError : log;
  write("[dolibarr] <-", `${method} ${path}`, {
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
  logError("[dolibarr] !!", `${method} ${path}`, {
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

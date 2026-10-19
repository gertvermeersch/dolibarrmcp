import assert from "node:assert/strict";

export type StubRequest = { method: string; path: string; params: URLSearchParams; body?: unknown };

// Return this from a route to answer with an error status instead of a body.
export class StubError {
  constructor(readonly status: number, readonly body: unknown = { error: { code: status, message: "Forbidden" } }) {}
}

// A route returns a response body, or undefined when the request is not its own.
export type StubRoute = (request: StubRequest) => unknown | undefined;

/**
 * Replace global fetch with a router over the given routes while `run` executes.
 * Requests no route answers fail the test, so tests show exactly which Dolibarr
 * calls a flow makes.
 */
export async function withDolibarr<T>(
  routes: StubRoute[],
  run: (requests: StubRequest[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const requests: StubRequest[] = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const request: StubRequest = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/api\/index\.php/, ""),
      params: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);

    for (const route of routes) {
      const body = route(request);
      if (body instanceof StubError) return new Response(JSON.stringify(body.body), { status: body.status });
      if (body !== undefined) return new Response(JSON.stringify(body), { status: 200 });
    }
    assert.fail(`Unrouted request: ${request.method} ${request.path}?${request.params}`);
  };

  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export const get = (
  pattern: RegExp,
  body: unknown | ((match: RegExpExecArray, request: StubRequest) => unknown),
): StubRoute => (request) => {
  if (request.method !== "GET") return undefined;
  const match = pattern.exec(request.path);
  if (!match) return undefined;
  return typeof body === "function"
    ? (body as (m: RegExpExecArray, r: StubRequest) => unknown)(match, request)
    : body;
};

export const send = (
  method: "POST" | "PUT",
  pattern: RegExp,
  body: unknown | ((match: RegExpExecArray, request: StubRequest) => unknown),
): StubRoute => (request) => {
  if (request.method !== method) return undefined;
  const match = pattern.exec(request.path);
  if (!match) return undefined;
  return typeof body === "function"
    ? (body as (m: RegExpExecArray, r: StubRequest) => unknown)(match, request)
    : body;
};

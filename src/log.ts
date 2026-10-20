import { AsyncLocalStorage } from "node:async_hooks";

// Who is making the current MCP request. Stored in AsyncLocalStorage so log
// lines emitted deep in the call chain (e.g. Dolibarr API calls made by a tool
// handler) can be attributed without threading it through every function.
export type Caller = {
  userAgent?: string;
  client?: string;
  ip?: string;
};

const callerStorage = new AsyncLocalStorage<Caller>();

export function runWithCaller<T>(caller: Caller, fn: () => T): T {
  return callerStorage.run(caller, fn);
}

function prefix(): string {
  const caller = callerStorage.getStore();
  const parts = [new Date().toISOString()];

  if (caller) {
    const who = [caller.client, caller.userAgent && `ua=${caller.userAgent}`, caller.ip]
      .filter(Boolean)
      .join(" ");
    if (who) parts.push(`[${who}]`);
  }

  return parts.join(" ");
}

export function log(...args: unknown[]): void {
  console.log(prefix(), ...args);
}

export function logError(...args: unknown[]): void {
  console.error(prefix(), ...args);
}

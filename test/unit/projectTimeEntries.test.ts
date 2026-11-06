import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, send, StubError, withDolibarr, type StubRoute } from "./helpers/dolibarrStub.js";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";
process.env.MCP_ALLOW_DELETES = "true";

const { registerTools } = await import("../../src/server.js");

type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
type RegisteredTools = Record<string, { handler: Handler; inputSchema?: { parseAsync(args: unknown): Promise<Record<string, unknown>> } }>;

const server = new McpServer({ name: "time-entry-tools-test", version: "0.0.0" });
registerTools(server);
const registered = (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const tool = registered[name];
  assert.ok(tool, `Expected ${name} to be registered`);
  const parsed = tool.inputSchema ? await tool.inputSchema.parseAsync(args) : args;
  const result = await tool.handler(parsed, {});
  return JSON.parse(result.content[0].text);
}

// 2025-11-13 13:00 Brussels (12:00 GMT), 30 minutes.
const datehour = Date.UTC(2025, 10, 13, 12, 0) / 1000;

function entry(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    fk_element: 51,
    element_date: Date.UTC(2025, 10, 12, 23, 0) / 1000,
    element_datehour: datehour,
    element_date_withhour: 1,
    element_duration: 1800,
    fk_user: 2,
    fk_product: null,
    note: null,
    note_private: "Example integration work",
    invoice_id: null,
    ...overrides,
  };
}

function row(id: number, taskId = 51) {
  return {
    rowid: id, element_duration: 1800, element_datehour: "2025-11-13 13:00:00", fk_user: 2,
    user_firstname: "Example", user_lastname: "User", project_id: 3, project_ref: "PJ-EXAMPLE-0003",
    project_title: "Example Webshop", task_id: taskId, task_ref: `TK-EXAMPLE-00${taskId}`, task_label: "Example technical work",
    soc_id: 84, soc_name: "Example Customer",
  };
}

function task(id: number, overrides: Record<string, unknown> = {}) {
  return { id: String(id), ref: `TK-EXAMPLE-00${id}`, label: `Task ${id}`, fk_project: "3", duration_effective: "5400", ...overrides };
}

// alltimespent by et.rowid, and by task for the delete flow.
function timeRoutes(rows: ReturnType<typeof row>[]): StubRoute {
  return get(/^\/projects\/alltimespent$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) => {
    const filter = r.params.get("sqlfilters") ?? "";
    const byEntry = /\(et\.rowid:=:(\d+)\)/.exec(filter);
    if (byEntry) return rows.filter((candidate) => candidate.rowid === Number(byEntry[1]));
    const byTask = /\(t\.rowid:=:(\d+)\)/.exec(filter);
    if (byTask) return rows.filter((candidate) => candidate.task_id === Number(byTask[1]));
    return rows;
  });
}

test("update_time_entry changes the hours and resends the current date, time, note and user", async () => {
  let updated = false;

  await withDolibarr([
    timeRoutes([row(103)]),
    get(/^\/tasks\/51\/getTimeSpent\/103$/, () => entry(103, updated ? { element_duration: 3600 } : {})),
    send("PUT", /^\/tasks\/51\/timespent\/103$/, () => { updated = true; return { success: { code: 200 } }; }),
    get(/^\/tasks\/51$/, task(51)),
  ], async (requests) => {
    const result = await callTool("update_time_entry", { entry_id: 103, hours: 1 });

    assert.equal(result.success, true);
    assert.deepEqual(result.changed, ["hours"]);
    assert.deepEqual(requests.find((r) => r.method === "PUT")?.body, {
      date: "2025-11-13 12:00:00",
      duration: 3600,
      user_id: 2,
      note: "Example integration work",
      product_id: null,
    });
    assert.equal(result.before.hours, 0.5);
    assert.equal(result.before.start_time, "13:00");
    assert.equal(result.after.hours, 1);
    assert.equal(result.after.note, "Example integration work");
    assert.equal(result.task_spent_hours, 1.5);
  });
});

test("update_time_entry moves the date and keeps the start time", async () => {
  await withDolibarr([
    timeRoutes([row(103)]),
    get(/^\/tasks\/51\/getTimeSpent\/103$/, entry(103)),
    send("PUT", /^\/tasks\/51\/timespent\/103$/, { success: { code: 200 } }),
    get(/^\/tasks\/51$/, task(51)),
  ], async (requests) => {
    await callTool("update_time_entry", { entry_id: 103, date: "2025-07-01", note: "" });
    const body = requests.find((r) => r.method === "PUT")?.body as Record<string, unknown>;
    // 13:00 Brussels in summer is 11:00 GMT; an empty note clears it.
    assert.equal(body.date, "2025-07-01 11:00:00");
    assert.equal(body.note, "");
    assert.equal(body.duration, 1800);
  });
});

test("update_time_entry refuses invoiced time and unknown entries", async () => {
  await withDolibarr([
    timeRoutes([row(103)]),
    get(/^\/tasks\/51\/getTimeSpent\/103$/, entry(103, { invoice_id: 251 })),
  ], async (requests) => {
    const result = await callTool("update_time_entry", { entry_id: 103, hours: 2 });
    assert.equal(result.error, "TIME_ENTRY_INVOICED");
    assert.ok(!requests.some((r) => r.method === "PUT"));

    const missing = await callTool("update_time_entry", { entry_id: 999, hours: 2 });
    assert.equal(missing.error, "TIME_ENTRY_NOT_FOUND");
  });
});

test("delete_time_entry dry-runs, then deletes and checks the entry is gone", async () => {
  let deleted = false;

  await withDolibarr([
    timeRoutes([row(103)]),
    get(/^\/tasks\/51\/getTimeSpent\/103$/, () => (deleted ? new StubError(404) : entry(103))),
    (r) => (r.method === "DELETE" && r.path === "/tasks/51/timespent/103"
      ? (deleted = true, { success: { code: 200 } })
      : undefined),
    get(/^\/tasks\/51$/, task(51, { duration_effective: "3600" })),
  ], async (requests) => {
    const dryRun = await callTool("delete_time_entry", { entry_id: 103 });
    assert.equal(dryRun.dry_run, true);
    assert.equal(dryRun.would_delete, true);
    assert.equal(dryRun.entry.note, "Example integration work");
    assert.ok(!requests.some((r) => r.method === "DELETE"));

    const result = await callTool("delete_time_entry", { entry_id: 103, confirm: true });
    assert.equal(result.success, true);
    assert.equal(result.task_spent_hours_after, 1);
  });
});

test("delete_time_entry reports an entry Dolibarr did not really delete", async () => {
  await withDolibarr([
    timeRoutes([row(103)]),
    get(/^\/tasks\/51\/getTimeSpent\/103$/, entry(103)),
    (r) => (r.method === "DELETE" ? { success: { code: 200 } } : undefined),
  ], async () => {
    const result = await callTool("delete_time_entry", { entry_id: 103, confirm: true });
    assert.equal(result.error, "DOLIBARR_API_ERROR");
    assert.match(result.message, /still exists/);
  });
});

function taskDeleteRoutes(state: { deleted: Set<string> }, options: { invoicedEntry?: number; subtaskOf?: number } = {}): StubRoute[] {
  return [
    get(/^\/tasks\/51$/, () => (state.deleted.has("task") ? new StubError(404) : task(51))),
    get(/^\/tasks$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) => {
      const filter = r.params.get("sqlfilters") ?? "";
      if (filter.startsWith("(t.ref:=:")) return [];
      return [task(51), ...(options.subtaskOf ? [task(60, { fk_task_parent: String(options.subtaskOf) })] : [])];
    }),
    timeRoutes([row(103), row(104)]),
    get(/^\/tasks\/51\/getTimeSpent\/(\d+)$/, (m: RegExpExecArray) =>
      entry(Number(m[1]), Number(m[1]) === options.invoicedEntry ? { invoice_id: 251 } : {})),
    (r) => {
      if (r.method !== "DELETE") return undefined;
      state.deleted.add(r.path === "/tasks/51" ? "task" : r.path);
      return { success: { code: 200 } };
    },
  ];
}

test("delete_task refuses a task with time unless delete_time_entries is set", async () => {
  const state = { deleted: new Set<string>() };

  await withDolibarr(taskDeleteRoutes(state), async (requests) => {
    const dryRun = await callTool("delete_task", { task: "51" });
    assert.equal(dryRun.would_delete, false);
    assert.deepEqual(dryRun.linked, { subtasks: 0, time_entries: 2, hours: 1 });
    assert.match(dryRun.blocked_reason, /delete_time_entries/);

    const refused = await callTool("delete_task", { task: "51", confirm: true });
    assert.equal(refused.error, "TASK_HAS_TIME");
    assert.ok(!requests.some((r) => r.method === "DELETE"));

    const result = await callTool("delete_task", { task: "51", confirm: true, delete_time_entries: true });
    assert.equal(result.success, true);
    assert.equal(result.deleted_time_entries, 2);
    assert.deepEqual(
      requests.filter((r) => r.method === "DELETE").map((r) => r.path),
      ["/tasks/51/timespent/103", "/tasks/51/timespent/104", "/tasks/51"],
    );
  });
});

test("delete_task deletes nothing when any of its time is invoiced", async () => {
  const state = { deleted: new Set<string>() };

  await withDolibarr(taskDeleteRoutes(state, { invoicedEntry: 104 }), async (requests) => {
    const result = await callTool("delete_task", { task: "51", confirm: true, delete_time_entries: true });
    assert.equal(result.error, "TIME_ENTRY_INVOICED");
    assert.ok(!requests.some((r) => r.method === "DELETE"));
  });
});

test("delete_task refuses a task with subtasks", async () => {
  const state = { deleted: new Set<string>() };

  await withDolibarr(taskDeleteRoutes(state, { subtaskOf: 51 }), async (requests) => {
    const result = await callTool("delete_task", { task: "51", confirm: true, delete_time_entries: true });
    assert.equal(result.error, "TASK_HAS_SUBTASKS");
    assert.equal(result.candidates[0].id, 60);
    assert.ok(!requests.some((r) => r.method === "DELETE"));
  });
});

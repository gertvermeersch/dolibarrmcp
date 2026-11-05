import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, send, StubError, withDolibarr } from "./helpers/dolibarrStub.js";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";

const { registerTools } = await import("../../src/server.js");
const rules = await import("../../src/dolibarr/projects/projectRules.js");
const { projectSqlFilters, timeEntrySqlFilters } = await import("../../src/dolibarr/projects/projectReadService.js");
const { ProjectWriteService } = await import("../../src/dolibarr/projects/projectWriteService.js");
const { unixTimestampFromIsoDate: ts } = await import("../../src/tools/shared/normalization.js");

type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
type RegisteredTools = Record<string, { handler: Handler; inputSchema?: { parseAsync(args: unknown): Promise<Record<string, unknown>> } }>;

const server = new McpServer({ name: "project-tools-test", version: "0.0.0" });
registerTools(server);
const registered = (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const tool = registered[name];
  assert.ok(tool, `Expected ${name} to be registered`);
  const parsed = tool.inputSchema ? await tool.inputSchema.parseAsync(args) : args;
  const result = await tool.handler(parsed, {});
  return JSON.parse(result.content[0].text);
}

// Dolibarr returns numeric fields as strings; keep that shape in fixtures.
function project(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: String(id),
    ref: `PJ2511-000${id}`,
    title: `Project ${id}`,
    socid: "7",
    status: "1",
    public: "0",
    date_start: ts("2026-10-01"),
    date_end: "",
    budget_amount: null,
    usage_opportunity: 0,
    usage_task: 1,
    usage_bill_time: 0,
    opp_status: null,
    opp_amount: null,
    opp_percent: null,
    ...overrides,
  };
}

function lead(id: number, stageId: number, amount: number | null, percent: number, overrides: Record<string, unknown> = {}) {
  return project(id, {
    usage_opportunity: 1,
    opp_status: String(stageId),
    opp_amount: amount === null ? null : String(amount),
    opp_percent: String(percent),
    ...overrides,
  });
}

function task(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: String(id),
    ref: `TK2511-00${id}`,
    label: `Task ${id}`,
    fk_project: "1",
    planned_workload: "36000",
    duration_effective: "9000",
    progress: "20",
    billable: "0",
    ...overrides,
  };
}

const thirdparty = { id: "7", name: "Acme", client: "1", fournisseur: "0" };

// Routes that resolve "PJ2511-0001" by ref and then fetch it by ID.
function projectRoutes(row: Record<string, unknown>) {
  return [
    get(/^\/projects$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) =>
      r.params.get("sqlfilters") === `(t.ref:=:'${row.ref}')` ? [row] : []),
    get(new RegExp(`^/projects/${row.id}$`), row),
  ];
}

test("lead summary derives stage name and weighted amount", () => {
  assert.deepEqual(rules.leadSummary(lead(1, 3, 10_000, 40) as never), {
    stage: "proposal",
    amount: 10_000,
    probability: 40,
    weighted_amount: 4_000,
  });
  assert.equal(rules.leadSummary(project(2) as never), undefined);
  assert.equal(rules.leadSummary(lead(3, 9, 100, 10) as never)?.stage, "stage_9");
});

test("pipeline summary groups open leads by stage in pipeline order", () => {
  const projects = [
    lead(1, 4, 20_000, 60, { date_end: ts("2026-10-15") }), // negotiation, overdue
    lead(2, 2, 5_000, 20),
    lead(3, 2, null, 20), // qualification without amount
    lead(4, 6, 8_000, 100), // won: not in the pipeline
    lead(5, 3, 1_000, 40, { status: "2" }), // closed: not in the pipeline
    project(6),
  ];

  const summary = rules.pipelineSummary(projects as never, "2026-11-05");

  assert.equal(summary.open_leads, 3);
  assert.equal(summary.total_amount, 25_000);
  assert.equal(summary.weighted_amount, 13_000);
  assert.deepEqual(summary.by_stage, [
    { stage: "qualification", count: 2, amount: 5_000, weighted_amount: 1_000 },
    { stage: "negotiation", count: 1, amount: 20_000, weighted_amount: 12_000 },
  ]);
  assert.deepEqual(summary.overdue.map((p) => p.id), ["1"]);
  assert.deepEqual(summary.without_amount.map((p) => p.id), ["3"]);
});

test("local start times convert to GMT across daylight saving time", () => {
  assert.equal(rules.gmtDateTimeFromLocal("2026-11-05", "09:00", "Europe/Brussels"), "2026-11-05 08:00:00");
  assert.equal(rules.gmtDateTimeFromLocal("2026-07-01", "09:30", "Europe/Brussels"), "2026-07-01 07:30:00");
  assert.equal(rules.gmtDateTimeFromLocal("2026-03-29", "12:00", "Europe/Brussels"), "2026-03-29 10:00:00");
  assert.equal(rules.gmtDateTimeFromLocal("2026-11-05", "00:30", "Europe/Brussels"), "2026-11-04 23:30:00");
});

test("task hours compare planned and spent", () => {
  assert.deepEqual(rules.taskHours(task(1) as never), { planned: 10, spent: 2.5, remaining: 7.5 });
  assert.deepEqual(rules.taskHours(task(2, { planned_workload: "0", duration_effective: null }) as never), {
    planned: undefined,
    spent: 0,
    remaining: undefined,
  });
});

test("sql filters combine project and time entry criteria", () => {
  assert.equal(
    projectSqlFilters({ status: 1, leadsOnly: true, leadStageId: 3, search: "web" }),
    "(t.fk_statut:=:1) and (t.usage_opportunity:=:1) and (t.fk_opp_status:=:3) and ((t.ref:like:'%web%') or (t.title:like:'%web%'))",
  );
  assert.equal(projectSqlFilters({}), undefined);
  assert.equal(
    timeEntrySqlFilters({ thirdpartyId: 7, userId: 2, from: "2026-11-01", to: "2026-11-30" }),
    "(p.fk_soc:=:7) and (et.fk_user:=:2) and (et.element_date:>=:'2026-11-01') and (et.element_date:<=:'2026-11-30')",
  );
});

test("list_projects filters leads by stage and serializes the lead", async () => {
  await withDolibarr([
    get(/^\/projects$/, [lead(1, 3, 10_000, 40)]),
    get(/^\/thirdparties\/7$/, thirdparty),
  ], async (requests) => {
    const result = await callTool("list_projects", { lead_stage: "proposal", status: "open" });

    assert.equal(requests[0].params.get("sqlfilters"), "(t.fk_statut:=:1) and (t.fk_opp_status:=:3)");
    assert.equal(result.count, 1);
    assert.equal(result.projects[0].client_name, "Acme");
    assert.equal(result.projects[0].status, "open");
    assert.deepEqual(result.projects[0].lead, { stage: "proposal", amount: 10_000, probability: 40, weighted_amount: 4_000 });
  });
});

test("create_project creates an open lead with the API user as project leader", async () => {
  const created = lead(12, 3, 15_000, 40, { ref: "PJ2511-0012", title: "New website" });

  await withDolibarr([
    get(/^\/thirdparties\/7$/, thirdparty),
    send("POST", /^\/projects$/, 12),
    get(/^\/users\/info$/, { id: 3 }),
    send("POST", /^\/projects\/12\/contacts$/, { success: true }),
    send("POST", /^\/projects\/12\/validate$/, { success: { code: 200 } }),
    get(/^\/projects\/12$/, created),
  ], async (requests) => {
    const result = await callTool("create_project", {
      thirdparty: "7",
      title: "New website",
      start_date: "2026-11-05",
      lead: { stage: "proposal", amount: 15_000 },
    });

    assert.equal(result.success, true);
    assert.equal(result.project.ref, "PJ2511-0012");
    assert.equal(result.project.client_name, "Acme");
    assert.equal(result.warnings, undefined);

    const createBody = requests.find((r) => r.method === "POST" && r.path === "/projects")?.body;
    assert.deepEqual(createBody, {
      ref: "auto",
      title: "New website",
      socid: 7,
      date_start: ts("2026-11-05"),
      public: 0,
      usage_task: 1,
      usage_bill_time: 0,
      usage_opportunity: 1,
      opp_status: 3,
      opp_percent: 40,
      opp_amount: 15_000,
    });
    assert.deepEqual(requests.find((r) => r.path === "/projects/12/contacts")?.body, {
      fk_socpeople: 3,
      type_contact: "PROJECTLEADER",
      source: "internal",
    });
  });
});

test("create_project keeps going with a warning when the project leader cannot be set", async () => {
  const service = new ProjectWriteService({
    createProject: async () => 5,
    currentUserId: async () => 3,
    addProjectUserContact: async () => { throw new Error("type not found"); },
    validateProject: async () => undefined,
    getProject: async () => project(5) as never,
    today: () => "2026-11-05",
  });

  const result = await service.createProject({
    thirdpartyId: 7, title: "X", usesTasks: true, billsTime: false, visibleToEveryone: false, open: true,
  });

  assert.ok("success" in result);
  assert.match(result.warnings[0], /type not found/);
});

test("update_project moves a lead stage and takes the stage probability", async () => {
  const row = lead(1, 2, 5_000, 20);

  await withDolibarr([
    ...projectRoutes(row),
    send("PUT", /^\/projects\/1$/, row),
    get(/^\/thirdparties\/7$/, thirdparty),
  ], async (requests) => {
    const result = await callTool("update_project", { project: "PJ2511-0001", lead_stage: "negotiation" });

    assert.equal(result.success, true);
    assert.deepEqual(requests.find((r) => r.method === "PUT")?.body, {
      usage_opportunity: 1,
      opp_status: 4,
      opp_percent: 60,
    });
  });
});

test("update_project without changes is a validation error", async () => {
  await withDolibarr(projectRoutes(project(1)), async () => {
    const result = await callTool("update_project", { project: "PJ2511-0001" });
    assert.equal(result.error, "VALIDATION_ERROR");
  });
});

test("set_project_status closes an open project through PUT", async () => {
  const row = project(1);

  await withDolibarr([
    ...projectRoutes(row),
    get(/^\/users\/info$/, { id: 3 }),
    send("PUT", /^\/projects\/1$/, { ...row, status: "2" }),
    get(/^\/thirdparties\/7$/, thirdparty),
  ], async (requests) => {
    const result = await callTool("set_project_status", { project: "PJ2511-0001", status: "closed" });

    assert.equal(result.success, true);
    assert.deepEqual(result.steps, ["closed"]);
    const body = requests.find((r) => r.method === "PUT")?.body as Record<string, unknown>;
    assert.equal(body.status, 2);
    assert.equal(body.fk_user_close, 3);
    assert.equal(typeof body.date_close, "number");
  });
});

test("set_project_status reopens a closed project with validate", async () => {
  let reopened = false;
  // Dolibarr keeps date_close after reopening.
  const row = () => project(1, { status: reopened ? "1" : "2", date_close: ts("2026-11-01") });

  await withDolibarr([
    get(/^\/projects$/, () => [row()]),
    get(/^\/projects\/1$/, () => row()),
    send("POST", /^\/projects\/1\/validate$/, () => { reopened = true; return { success: { code: 200 } }; }),
    get(/^\/thirdparties\/7$/, thirdparty),
  ], async () => {
    const result = await callTool("set_project_status", { project: "PJ2511-0001", status: "open" });
    assert.equal(result.previous_status, "closed");
    assert.equal(result.status, "open");
    assert.deepEqual(result.steps, ["reopened"]);
    assert.equal(result.project.closed_on, undefined);
  });
});

test("log_time uses the project's only task and sends the start time in GMT", async () => {
  let logged = false;
  const row = project(1);

  await withDolibarr([
    ...projectRoutes(row),
    get(/^\/tasks$/, [task(21)]),
    get(/^\/tasks\/21$/, () => task(21, { duration_effective: logged ? "14400" : "9000" })),
    send("POST", /^\/tasks\/21\/addtimespent$/, () => { logged = true; return { success: { code: 200 } }; }),
  ], async (requests) => {
    const result = await callTool("log_time", {
      project: "PJ2511-0001",
      hours: 1.5,
      date: "2026-11-05",
      note: "Design review",
    });

    assert.equal(result.success, true);
    assert.deepEqual(requests.find((r) => r.path === "/tasks/21/addtimespent")?.body, {
      date: "2026-11-05 08:00:00",
      duration: 5400,
      user_id: 0,
      note: "Design review",
    });
    assert.equal(result.task_spent_hours_before, 2.5);
    assert.equal(result.task_spent_hours_after, 4);
  });
});

test("log_time matches a task label within the project", async () => {
  await withDolibarr([
    ...projectRoutes(project(1)),
    // The ref lookup finds nothing; the project's task list has both tasks.
    get(/^\/tasks$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) =>
      r.params.get("sqlfilters") === "(t.fk_projet:=:1)"
        ? [task(21, { label: "Design" }), task(22, { label: "Development" })]
        : []),
    get(/^\/tasks\/22$/, task(22, { label: "Development" })),
    send("POST", /^\/tasks\/22\/addtimespent$/, { success: { code: 200 } }),
  ], async (requests) => {
    const result = await callTool("log_time", { project: "PJ2511-0001", task: "develop", hours: 2, start_time: "14:00", date: "2026-07-01" });

    assert.equal(result.success, true);
    assert.equal((requests.find((r) => r.method === "POST")?.body as Record<string, unknown>).date, "2026-07-01 12:00:00");
  });
});

test("log_time returns the task list when the project has several tasks", async () => {
  await withDolibarr([
    ...projectRoutes(project(1)),
    get(/^\/tasks$/, [task(21), task(22)]),
  ], async (requests) => {
    const result = await callTool("log_time", { project: "PJ2511-0001", hours: 1 });

    assert.equal(result.error, "TASK_AMBIGUOUS");
    assert.deepEqual(result.candidates.map((c: { id: number }) => c.id), [21, 22]);
    assert.ok(!requests.some((r) => r.method === "POST"));
  });
});

test("log_time rejects a bad start time before writing", async () => {
  await withDolibarr([
    get(/^\/tasks\/21$/, task(21)),
  ], async (requests) => {
    const result = await callTool("log_time", { task: "21", hours: 1, start_time: "9am" });
    assert.equal(result.error, "VALIDATION_ERROR");
    assert.ok(!requests.some((r) => r.method === "POST"));
  });
});

test("project titles resolve by substring and report ambiguity", async () => {
  const { resolveProject } = await import("../../src/resolvers/project.js");

  await withDolibarr([
    get(/^\/projects$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) =>
      (r.params.get("sqlfilters") ?? "").includes("t.title:like")
        ? [project(1, { title: "Website Acme" }), project(2, { title: "Website Beta" })]
        : []),
    get(/^\/thirdparties\/7$/, thirdparty),
  ], async () => {
    const result = await resolveProject("website");
    assert.ok(!result.ok);
    assert.equal(result.error.error, "PROJECT_AMBIGUOUS");
    assert.equal(result.error.candidates?.length, 2);
  });

  await withDolibarr([
    get(/^\/projects$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) =>
      (r.params.get("sqlfilters") ?? "").includes("t.title:like")
        ? [project(1, { title: "Website" }), project(2, { title: "Website relaunch" })]
        : []),
  ], async () => {
    const result = await resolveProject("website");
    assert.ok(result.ok);
    assert.equal(result.project.id, "1");
  });
});

test("get_project_detail combines tasks, time and linked documents", async () => {
  const row = project(1, { budget_amount: "10000" });
  const timeRow = (id: number, user: string, seconds: number, date: string) => ({
    rowid: id, element_duration: seconds, element_datehour: `${date} 08:00:00`, fk_user: user === "Gert" ? 1 : 2,
    user_firstname: user, user_lastname: "", project_id: 1, project_ref: row.ref, project_title: row.title,
    task_id: 21, task_ref: "TK2511-0021", task_label: "Task 21", soc_id: 7, soc_name: "Acme",
  });

  await withDolibarr([
    ...projectRoutes(row),
    get(/^\/tasks$/, [task(21), task(22, { planned_workload: "7200", duration_effective: "0" })]),
    get(/^\/projects\/alltimespent$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) => {
      assert.equal(r.params.get("sqlfilters"), "(p.rowid:=:1)");
      return [timeRow(3, "Gert", 3600, "2026-11-04"), timeRow(2, "Ann", 5400, "2026-11-02")];
    }),
    get(/^\/proposals$/, [{ id: 5, ref: "PR-5", socid: 7, statut: 2, total_ht: 9000, total_ttc: 10890, date: ts("2026-10-02") }]),
    get(/^\/orders$/, new StubError(403)),
    get(/^\/invoices$/, [
      { id: 8, ref: "FA-8", socid: 7, statut: 2, total_ht: 4500, total_ttc: 5445, date: ts("2026-10-20") },
      { id: 9, ref: "FA-9", socid: 7, statut: 0, total_ht: 4500, total_ttc: 5445, date: ts("2026-11-01") },
    ]),
    get(/^\/supplierinvoices$/, []),
    get(/^\/thirdparties\/7$/, thirdparty),
  ], async () => {
    const result = await callTool("get_project_detail", { project: "PJ2511-0001" });

    assert.equal(result.project.client_name, "Acme");
    assert.equal(result.tasks.length, 2);
    assert.equal(result.hours.planned, 12);
    assert.equal(result.hours.spent, 2.5);
    assert.equal(result.hours.last_entry_date, "2026-11-04");
    assert.deepEqual(result.hours.by_user, [
      { user: "Ann", hours: 1.5, entries: 1 },
      { user: "Gert", hours: 1, entries: 1 },
    ]);
    assert.deepEqual(result.documents.orders, []);
    assert.deepEqual(result.totals, {
      budget: 10000,
      proposals_signed_excl_tax: 9000,
      invoiced_excl_tax: 4500,
      supplier_costs_excl_tax: 0,
    });
  });
});

test("list_time_entries filters on the project's thirdparty and totals the hours", async () => {
  await withDolibarr([
    get(/^\/projects\/alltimespent$/, (_m: RegExpExecArray, r: { params: URLSearchParams }) => {
      assert.equal(r.params.get("sqlfilters"), "(p.fk_soc:=:7) and (et.element_date:>=:'2026-11-01')");
      assert.equal(r.params.get("thirdparty_ids"), null);
      return [
        { rowid: 1, element_duration: 3600, element_datehour: "2026-11-03 08:00:00", fk_user: 1, user_login: "gert", project_id: 1, project_ref: "PJ1", project_title: "Site", task_id: 21, task_label: "Design" },
        { rowid: 2, element_duration: 1800, element_datehour: "2026-11-02 08:00:00", fk_user: 1, user_login: "gert", project_id: 1, project_ref: "PJ1", project_title: "Site", task_id: 22, task_label: "Build" },
      ];
    }),
  ], async () => {
    const result = await callTool("list_time_entries", { thirdparty_id: 7, date_from: "2026-11-01", max_entries: 1 });

    assert.equal(result.total_hours, 1.5);
    assert.equal(result.count, 2);
    assert.equal(result.entries.length, 1);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.by_project, [{ project: "PJ1 Site", hours: 1.5, entries: 2 }]);
    assert.equal(result.entries[0].user, "gert");
  });
});

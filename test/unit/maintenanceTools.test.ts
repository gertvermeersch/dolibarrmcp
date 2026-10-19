import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, send, StubError, withDolibarr } from "./helpers/dolibarrStub.js";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";

const { registerTools } = await import("../../src/server.js");
const { addDaysIso, addMonthsIso, todayIso } = await import("../../src/dolibarr/maintenance/contractRules.js");
const { unixTimestampFromIsoDate: ts } = await import("../../src/tools/shared/normalization.js");

type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
type RegisteredTools = Record<string, { handler: Handler; inputSchema?: { parseAsync(args: unknown): Promise<Record<string, unknown>> } }>;

const server = new McpServer({ name: "maintenance-tools-test", version: "0.0.0" });
registerTools(server);
// The SDK keeps registered tools in a private field; reach in like the integration tests do.
const registered = (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;

// Parses the arguments like the MCP server does, so schema defaults apply.
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const tool = registered[name];
  assert.ok(tool, `Expected ${name} to be registered`);
  const parsed = tool.inputSchema ? await tool.inputSchema.parseAsync(args) : args;
  const result = await tool.handler(parsed, {});
  return JSON.parse(result.content[0].text);
}

const today = todayIso();
const endSoon = addDaysIso(today, 20);
const endedAgo = addDaysIso(today, -10);
const start = addMonthsIso(endSoon, -12);

function line(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    statut: "4",
    qty: "2",
    subprice: "600.00000000",
    total_ht: "1200.00000000",
    tva_tx: "21.000",
    fk_product: "55",
    product_ref: "MAINT",
    product_label: "Maintenance plan",
    desc: "Maintenance plan",
    date_start: ts(start),
    date_end: ts(endSoon),
    date_start_real: ts(start),
    ...overrides,
  };
}

function contract(id: number, overrides: Record<string, unknown> = {}) {
  return { id, ref: `CT-${id}`, socid: "7", date_contrat: ts(start), statut: "1", lines: [line(id * 10)], ...overrides };
}

const invoice = (id: number, date: string) => ({
  id,
  ref: `FA-${id}`,
  socid: 7,
  date: ts(date),
  statut: 1,
  paye: 0,
  total_ht: 1200,
  total_tva: 252,
  total_ttc: 1452,
  remaintopay: 1452,
});

const thirdparty = { id: 7, name: "Acme BV", client: 1, supplier: 0, email: "info@acme.test", town: "Gent" };

const visit = (id: number, date: string, overrides: Record<string, unknown> = {}) => ({
  id,
  ref: `FI-${id}`,
  socid: "7",
  fk_contrat: "1",
  statut: "3",
  description: "Updated plugins",
  duration: "5400",
  lines: [{ id, date: ts(date), duration: "5400" }],
  ...overrides,
});

const firstPage = <T>(rows: T[]) => (_m: RegExpExecArray, r: { params: URLSearchParams }) =>
  (r.params.get("page") === "0" ? rows : []);

test("registerTools exposes the maintenance tools", () => {
  for (const name of [
    "list_contracts_by_expiry",
    "get_contract_detail",
    "list_interventions",
    "get_maintenance_overview",
    "create_contract",
    "create_renewal_invoice",
    "create_intervention",
    "set_contract_status",
    "search_across",
  ]) {
    assert.ok(registered[name], `${name} should be registered`);
  }
});

test("list_contracts_by_expiry returns the documented fields, sorted by end date", async () => {
  const contracts = [
    contract(1),
    contract(2, { lines: [line(20, { date_start: ts(addMonthsIso(addDaysIso(endedAgo, 1), -12)), date_end: ts(endedAgo) })] }),
  ];

  await withDolibarr(
    [
      get(/^\/contracts$/, firstPage(contracts)),
      get(/^\/contracts\/1$/, { ...contracts[0], linkedObjectsIds: { facture: { "0": 91 } } }),
      get(/^\/contracts\/2$/, { ...contracts[1], linkedObjectsIds: {} }),
      get(/^\/invoices\/91$/, invoice(91, start)),
      get(/^\/thirdparties\/7$/, thirdparty),
    ],
    async () => {
      const result = await callTool("list_contracts_by_expiry", {});

      assert.equal(result.as_of, today);
      assert.equal(result.count, 2);
      assert.deepEqual(result.contracts.map((c: { ref: string }) => c.ref), ["CT-2", "CT-1"]);
      assert.deepEqual(result.contracts[0], {
        id: 2,
        ref: "CT-2",
        client: "Acme BV",
        client_id: 7,
        services: [{ product_ref: "MAINT", label: "Maintenance plan", qty: 2 }],
        end_date: endedAgo,
        days_until_end: -10,
        annual_value_excluding_tax: 1200,
        status: "expired",
        renewal_invoiced: false,
      });
      // CT-1's only linked invoice is the initial one, dated on the start date.
      assert.equal(result.contracts[1].status, "expiring");
      assert.equal(result.contracts[1].days_until_end, 20);
      assert.equal(result.contracts[1].renewal_invoiced, false);
    },
  );
});

test("list_contracts_by_expiry applies its defaults and filters", async () => {
  await withDolibarr(
    [get(/^\/contracts$/, firstPage([]))],
    async (requests) => {
      const result = await callTool("list_contracts_by_expiry", { thirdparty_id: 7 });

      assert.equal(result.count, 0);
      assert.equal(result.days_ahead, 60);
      assert.equal(requests[0].params.get("thirdparty_ids"), "7");
    },
  );
});

test("get_contract_detail returns lines, invoices with payment status, and interventions", async () => {
  const detail = { ...contract(1), linkedObjectsIds: { facture: { "0": 91, "1": 92 } } };

  await withDolibarr(
    [
      get(/^\/contracts\/1$/, detail),
      get(/^\/invoices\/91$/, invoice(91, start)),
      get(/^\/invoices\/92$/, invoice(92, addDaysIso(start, 365))),
      get(/^\/interventions$/, firstPage([visit(5, addDaysIso(start, 100))])),
      get(/^\/thirdparties\/7$/, thirdparty),
    ],
    async () => {
      const result = await callTool("get_contract_detail", { contract: "1" });

      assert.equal(result.ref, "CT-1");
      assert.equal(result.status, "validated");
      assert.equal(result.running, true);
      assert.deepEqual(result.dates, { start, end: endSoon, days_until_end: 20 });
      assert.equal(result.renewal_invoiced, true);
      assert.equal(result.client.name, "Acme BV");

      assert.equal(result.lines.length, 1);
      assert.equal(result.lines[0].status, "running");
      assert.equal(result.lines[0].expired, false);
      assert.equal(result.lines[0].line_id, 10);
      assert.equal(result.lines[0].start_date, start);
      assert.equal(result.lines[0].end_date, endSoon);

      assert.deepEqual(result.invoices.map((i: { id: number; is_renewal: boolean }) => [i.id, i.is_renewal]), [[91, false], [92, true]]);
      assert.equal(result.invoices[0].paid, false);
      assert.equal(result.invoices[0].remaining_to_pay, 1452);

      assert.deepEqual(result.interventions, [{
        id: 5,
        ref: "FI-5",
        contract_id: 1,
        date: addDaysIso(start, 100),
        duration_hours: 1.5,
        status: "done",
        description: "Updated plugins",
      }]);
    },
  );
});

test("get_contract_detail reports an unknown contract as CONTRACT_NOT_FOUND", async () => {
  await withDolibarr([get(/^\/contracts$/, [])], async () => {
    const result = await callTool("get_contract_detail", { contract: "CT-NOPE" });
    assert.equal(result.error, "CONTRACT_NOT_FOUND");
  });
});

test("list_interventions names the client and contract and validates dates", async () => {
  await withDolibarr(
    [
      get(/^\/interventions$/, firstPage([visit(5, "2026-03-10"), visit(6, "2026-05-02")])),
      get(/^\/thirdparties\/7$/, thirdparty),
      get(/^\/contracts\/1$/, contract(1)),
    ],
    async () => {
      const result = await callTool("list_interventions", { status: "done", from: "2026-04-01" });

      assert.equal(result.count, 1);
      assert.deepEqual(result.interventions[0], {
        id: 6,
        ref: "FI-6",
        client: "Acme BV",
        contract: "CT-1",
        contract_id: 1,
        date: "2026-05-02",
        duration_hours: 1.5,
        status: "done",
        description: "Updated plugins",
      });
    },
  );

  const invalid = await callTool("list_interventions", { from: "01-04-2026" });
  assert.equal(invalid.error, "VALIDATION_ERROR");
});

test("get_maintenance_overview names the client and flags contracts without a recent visit", async () => {
  const recent = addDaysIso(today, -30);
  const contracts = [contract(1), contract(2)];

  await withDolibarr(
    [
      get(/^\/thirdparties\/7$/, thirdparty),
      get(/^\/contracts$/, firstPage(contracts)),
      get(/^\/interventions$/, firstPage([visit(5, recent, { fk_contrat: "1" })])),
    ],
    async () => {
      const result = await callTool("get_maintenance_overview", { thirdparty_id: 7 });

      assert.deepEqual(result.client, { id: 7, name: "Acme BV" });
      assert.equal(result.lookback_from, addMonthsIso(today, -12));
      assert.deepEqual(result.contracts_without_recent_maintenance, ["CT-2"]);
      assert.equal(result.inactive_contracts, 0);
      assert.equal(result.contracts[0].ref, "CT-1");
      assert.deepEqual(result.contracts[0].last_done_intervention, {
        id: 5,
        ref: "FI-5",
        date: recent,
        duration_hours: 1.5,
        description: "Updated plugins",
      });
      assert.equal(result.contracts[0].no_maintenance_last_12_months, false);
      assert.equal(result.contracts[1].no_maintenance_last_12_months, true);
      assert.equal(result.contracts[1].last_done_intervention, undefined);
    },
  );
});

test("search_across also returns contracts and interventions", async () => {
  await withDolibarr(
    [
      get(/^\/thirdparties$/, []),
      get(/^\/invoices$/, []),
      get(/^\/supplierinvoices$/, []),
      get(/^\/orders$/, []),
      get(/^\/proposals$/, []),
      get(/^\/contracts$/, [contract(1)]),
      get(/^\/interventions$/, [visit(5, addDaysIso(start, 30))]),
      get(/^\/thirdparties\/7$/, thirdparty),
    ],
    async () => {
      const result = await callTool("search_across", { query: "CT-1" });

      assert.deepEqual(result.contracts, [{
        id: 1,
        ref: "CT-1",
        client_name: "Acme BV",
        status: "validated",
        date: start,
        end_date: endSoon,
        annual_value_excluding_tax: 1200,
      }]);
      assert.deepEqual(result.interventions, [{
        id: 5,
        ref: "FI-5",
        client_name: "Acme BV",
        status: "done",
        date: addDaysIso(start, 30),
        description: "Updated plugins",
      }]);
      assert.deepEqual(result.invoices, []);
    },
  );
});

test("create_renewal_invoice links the contract through linked_objects", async () => {
  const detail = { ...contract(1), linkedObjectsIds: { facture: { "0": 91 } } };
  const initial = invoice(91, start);

  await withDolibarr(
    [
      get(/^\/contracts\/1$/, (_m, r) => (r.method === "GET" ? detail : undefined)),
      get(/^\/invoices\/91$/, initial),
      send("POST", /^\/invoices$/, 120),
      send("POST", /^\/invoices\/120\/lines$/, 1),
    ],
    async (requests) => {
      // The contract has an initial invoice only, so the renewal is allowed.
      const result = await callTool("create_renewal_invoice", { contract: "1", date: today });

      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.invoice_id, 120);
      assert.deepEqual(result.period, {
        start: addDaysIso(endSoon, 1),
        end: addDaysIso(addMonthsIso(addDaysIso(endSoon, 1), 12), -1),
        months: 12,
      });
      assert.equal(result.total_excluding_tax, 1200);
      assert.equal(result.validated, false);
      // The mocked contract still lists invoice 91 only, so the link check warns.
      assert.equal(result.linked_to_contract, false);
      assert.ok(result.warning);

      const post = requests.find((r) => r.method === "POST" && r.path === "/invoices")!;
      assert.deepEqual(post.body, { socid: 7, date: ts(today), linked_objects: { contrat: 1 } });
    },
  );
});

test("contract detail and overview degrade when the interventions API is forbidden", async () => {
  const detail = { ...contract(1), linkedObjectsIds: {} };

  await withDolibarr(
    [
      get(/^\/contracts\/1$/, detail),
      get(/^\/interventions$/, new StubError(403)),
      get(/^\/thirdparties\/7$/, thirdparty),
    ],
    async () => {
      const result = await callTool("get_contract_detail", { contract: "1" });

      assert.equal(result.ref, "CT-1");
      assert.deepEqual(result.interventions, []);
      assert.equal(result.interventions_available, false);
      assert.match(result.warning, /Interventions API is not accessible/);
    },
  );

  await withDolibarr(
    [
      get(/^\/thirdparties\/7$/, thirdparty),
      get(/^\/contracts$/, firstPage([contract(1)])),
      get(/^\/interventions$/, new StubError(403)),
    ],
    async () => {
      const result = await callTool("get_maintenance_overview", { thirdparty_id: 7 });

      assert.equal(result.contracts.length, 1);
      assert.equal(result.interventions_available, false);
      // Without intervention data nothing can be concluded, so nothing is flagged.
      assert.equal(result.contracts[0].no_maintenance_last_12_months, undefined);
      assert.deepEqual(result.contracts_without_recent_maintenance, []);
    },
  );

  // list_interventions has nothing else to offer, so it reports the problem.
  await withDolibarr([get(/^\/interventions$/, new StubError(403))], async () => {
    const result = await callTool("list_interventions", {});
    assert.equal(result.error, "DOLIBARR_MODULE_UNAVAILABLE");
  });
});

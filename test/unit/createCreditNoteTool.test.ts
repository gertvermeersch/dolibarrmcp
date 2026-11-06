import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, send, StubError, withDolibarr, type StubRoute } from "./helpers/dolibarrStub.js";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";

const { registerTools } = await import("../../src/server.js");
const { unixTimestampFromIsoDate: ts } = await import("../../src/tools/shared/normalization.js");

type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
type RegisteredTools = Record<string, { handler: Handler; inputSchema?: { parseAsync(args: unknown): Promise<Record<string, unknown>> } }>;

const server = new McpServer({ name: "create-credit-note-test", version: "0.0.0" });
registerTools(server);
const registered = (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;

async function callTool(args: Record<string, unknown>): Promise<Record<string, any>> {
  const tool = registered.create_credit_note;
  assert.ok(tool, "create_credit_note is registered");
  const parsed = await tool.inputSchema!.parseAsync(args);
  return JSON.parse((await tool.handler(parsed, {})).content[0].text);
}

const date = "2026-11-06";

const sourceLine = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, desc: "Hosting", qty: "2", subprice: "100.00000000", tva_tx: "21.000", fk_product: "55",
  product_ref: "HOST", product_type: "1", total_ht: "200", ...overrides,
});

const source = (overrides: Record<string, unknown> = {}) => ({
  id: 10, ref: "FA2611-0010", socid: "7", type: "0", statut: "1", total_ht: "200", total_ttc: "242",
  date: ts(date), lines: [sourceLine(1)], ...overrides,
});

const sourceRoute = (overrides: Record<string, unknown> = {}): StubRoute => get(/^\/invoices\/10$/, source(overrides));
const creditNotesRoute = (notes: unknown[] = []): StubRoute => get(/^\/invoices$/, (_m, r) => {
  assert.match(r.params.get("sqlfilters") ?? "", /fk_facture_source:=:10/);
  return notes;
});
const createdRoute = (overrides: Record<string, unknown> = {}): StubRoute => get(/^\/invoices\/60$/, {
  id: 60, ref: "(PROV60)", socid: "7", type: "2", statut: "0", fk_facture_source: "10",
  total_ht: "-200", total_ttc: "-242", ...overrides,
});
const writes: StubRoute[] = [send("POST", /^\/invoices$/, 60), send("POST", /^\/invoices\/60\/lines$/, 1)];
const posts = (requests: Array<{ method: string }>) => requests.filter((r) => r.method === "POST");

test("full mode copies the invoice lines into a credit note linked to the invoice", async () => {
  await withDolibarr([sourceRoute(), creditNotesRoute(), createdRoute(), ...writes], async (requests) => {
    const result = await callTool({ invoice: "10", mode: "full", date, reason: "Billed twice" });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.credit_note_id, 60);
    assert.equal(result.invoice.ref, "FA2611-0010");
    assert.equal(result.credited_excluding_tax, 200);
    assert.equal(result.credited_including_tax, 242);
    assert.equal(result.linked_to_invoice, true);
    assert.equal(result.warning, undefined);

    const create = requests.find((r) => r.method === "POST" && r.path === "/invoices")!;
    assert.deepEqual(create.body, {
      socid: 7, date: ts(date), type: 2, fk_facture_source: 10, note_private: "Billed twice",
    });
    const line = requests.find((r) => r.path === "/invoices/60/lines")!;
    assert.deepEqual(line.body, {
      desc: "Hosting", qty: "2", subprice: "100.00000000", tva_tx: "21.000", fk_product: 55, product_type: "1",
    });
  });
});

test("full mode marks free-text lines (fk_product 0) as unresolved and sends no product", async () => {
  const lines = [sourceLine(1), sourceLine(2, { fk_product: "0", product_ref: null, desc: "Setup" })];
  await withDolibarr([sourceRoute({ lines, total_ht: "400" }), creditNotesRoute(), createdRoute(), ...writes], async (requests) => {
    const result = await callTool({ invoice: "10", mode: "full", date });

    assert.deepEqual(result.lines.map((line: { resolved: boolean }) => line.resolved), [true, false]);
    const bodies = requests.filter((r) => r.path === "/invoices/60/lines").map((r) => r.body as Record<string, unknown>);
    assert.equal("fk_product" in bodies[1], false);
  });
});

test("partial mode credits only the given lines with positive amounts", async () => {
  await withDolibarr(
    [sourceRoute(), creditNotesRoute(), createdRoute({ total_ht: "-50", total_ttc: "-60.5" }), ...writes],
    async (requests) => {
      const result = await callTool({
        invoice: "10", mode: "partial", date,
        lines: [{ description: "Downtime", qty: 1, unit_price: 50, vat_rate: 21 }],
      });

      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.credited_excluding_tax, 50);
      const line = requests.find((r) => r.path === "/invoices/60/lines")!;
      assert.deepEqual(line.body, { desc: "Downtime", qty: 1, subprice: 50, tva_tx: 21, product_type: 0 });
    },
  );
});

test("partial mode refuses to credit more than what is still creditable", async () => {
  const earlier = { id: 55, ref: "FA2611-0055", statut: "1", total_ht: "-150" };
  await withDolibarr([sourceRoute(), creditNotesRoute([earlier])], async (requests) => {
    const result = await callTool({
      invoice: "10", mode: "partial", date,
      lines: [{ description: "Extra", qty: 1, unit_price: 100, vat_rate: 21 }],
    });

    assert.equal(result.error, "CREDIT_EXCEEDS_INVOICE");
    assert.equal(posts(requests).length, 0);
  });
});

test("abandoned credit notes do not reduce the creditable amount", async () => {
  const cancelled = { id: 55, ref: "FA2611-0055", statut: "3", total_ht: "-150" };
  await withDolibarr([sourceRoute(), creditNotesRoute([cancelled]), createdRoute(), ...writes], async () => {
    const result = await callTool({ invoice: "10", mode: "full", date });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.already_credited_excluding_tax, 0);
  });
});

test("full mode refuses an invoice that already has a credit note", async () => {
  const earlier = { id: 55, ref: "FA2611-0055", statut: "1", total_ht: "-50" };
  await withDolibarr([sourceRoute(), creditNotesRoute([earlier])], async (requests) => {
    const result = await callTool({ invoice: "10", mode: "full", date });

    assert.equal(result.error, "VALIDATION_ERROR");
    assert.match(result.message, /FA2611-0055/);
    assert.equal(posts(requests).length, 0);
  });
});

test("full mode refuses invoices with negative lines", async () => {
  const lines = [sourceLine(1), sourceLine(2, { subprice: "-20", total_ht: "-20" })];
  await withDolibarr([sourceRoute({ lines }), creditNotesRoute()], async (requests) => {
    const result = await callTool({ invoice: "10", mode: "full", date });

    assert.equal(result.error, "VALIDATION_ERROR");
    assert.match(result.message, /negative/);
    assert.equal(posts(requests).length, 0);
  });
});

test("draft invoices and credit notes cannot be credited", async () => {
  for (const overrides of [{ statut: "0" }, { statut: "3" }, { type: "2" }]) {
    await withDolibarr([sourceRoute(overrides)], async (requests) => {
      const result = await callTool({ invoice: "10", mode: "full", date });

      assert.equal(result.error, "VALIDATION_ERROR", JSON.stringify(overrides));
      assert.equal(posts(requests).length, 0);
    });
  }
});

test("mode and lines must agree, and unknown invoices are reported", async () => {
  await withDolibarr([get(/^\/invoices$/, [])], async (requests) => {
    const free = { description: "x", qty: 1, unit_price: 1, vat_rate: 21 };

    assert.equal((await callTool({ invoice: "10", mode: "partial" })).error, "VALIDATION_ERROR");
    assert.equal((await callTool({ invoice: "10", mode: "full", lines: [free] })).error, "VALIDATION_ERROR");
    assert.equal((await callTool({ invoice: "FA9999-0001", mode: "full" })).error, "INVOICE_NOT_FOUND");
    assert.equal(posts(requests).length, 0);
  });
});

test("negative prices are rejected before anything is created", async () => {
  await withDolibarr([sourceRoute(), creditNotesRoute()], async (requests) => {
    const result = await callTool({
      invoice: "10", mode: "partial", date,
      lines: [{ description: "Oops", qty: 1, unit_price: -10, vat_rate: 21 }],
    });

    assert.equal(result.error, "VALIDATION_ERROR");
    assert.equal(result.line_errors.length, 1);
    assert.equal(posts(requests).length, 0);
  });
});

test("a missing link is reported as a warning, and validate runs when asked", async () => {
  await withDolibarr(
    [sourceRoute(), creditNotesRoute(), createdRoute({ fk_facture_source: null, statut: "1" }), send("POST", /^\/invoices\/60\/validate$/, {}), ...writes],
    async (requests) => {
      const result = await callTool({ invoice: "10", mode: "full", date, validate: true });

      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.validated, true);
      assert.equal(result.linked_to_invoice, false);
      assert.ok(result.warning);
      assert.ok(requests.some((r) => r.path === "/invoices/60/validate"));
    },
  );
});

test("a failing line leaves the draft credit note and reports its id", async () => {
  await withDolibarr(
    [sourceRoute(), creditNotesRoute(), send("POST", /^\/invoices$/, 60), send("POST", /^\/invoices\/60\/lines$/, () => new StubError(500, { error: { code: 500, message: "boom" } }))],
    async () => {
      const result = await callTool({ invoice: "10", mode: "full", date });

      assert.equal(result.error, "DOLIBARR_API_ERROR");
      assert.equal(result.credit_note_id, 60);
      assert.equal(result.failed_step, "add lines");
    },
  );
});

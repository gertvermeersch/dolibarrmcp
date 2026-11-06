import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, send, withDolibarr } from "./helpers/dolibarrStub.js";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";

const { registerTools } = await import("../../src/server.js");
const { unixTimestampFromIsoDate: ts } = await import("../../src/tools/shared/normalization.js");

type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
type RegisteredTools = Record<string, { handler: Handler; inputSchema?: { parseAsync(args: unknown): Promise<Record<string, unknown>> } }>;

const server = new McpServer({ name: "create-invoice-test", version: "0.0.0" });
registerTools(server);
const registered = (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
  const tool = registered[name];
  const parsed = tool.inputSchema ? await tool.inputSchema.parseAsync(args) : args;
  const result = await tool.handler(parsed, {});
  return JSON.parse(result.content[0].text);
}

const date = "2026-11-06";
const freeLine = { description: "Deposit 30%", qty: 1, unit_price: 300, vat_rate: 21 };
const thirdparty = get(/^\/thirdparties\/7$/, { id: 7, name: "Acme BV" });
const proposal = (socid: number, linkedObjectsIds: unknown = {}) =>
  get(/^\/proposals\/5$/, { id: 5, ref: "PR2611-0005", socid, statut: 2, linkedObjectsIds });

test("create_invoice defaults to a standard invoice without a proposal link", async () => {
  await withDolibarr(
    [thirdparty, send("POST", /^\/invoices$/, 50), send("POST", /^\/invoices\/50\/lines$/, 1)],
    async (requests) => {
      const result = await callTool("create_invoice", { client: "7", date, lines: [freeLine] });

      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.type, "standard");
      assert.equal(result.proposal, undefined);
      const post = requests.find((r) => r.method === "POST" && r.path === "/invoices")!;
      assert.deepEqual(post.body, { socid: 7, date: ts(date), type: 0 });
    },
  );
});

test("create_invoice creates a deposit invoice linked to a proposal", async () => {
  await withDolibarr(
    [
      thirdparty,
      proposal(7, { facture: { "0": 50 } }),
      send("POST", /^\/invoices$/, 50),
      send("POST", /^\/invoices\/50\/lines$/, 1),
    ],
    async (requests) => {
      const result = await callTool("create_invoice", {
        client: "7",
        date,
        type: "deposit",
        proposal: "5",
        lines: [freeLine],
      });

      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.type, "deposit");
      assert.deepEqual(result.proposal, { id: 5, ref: "PR2611-0005" });
      assert.equal(result.linked_to_proposal, true);
      assert.equal(result.warning, undefined);
      const post = requests.find((r) => r.method === "POST" && r.path === "/invoices")!;
      assert.deepEqual(post.body, { socid: 7, date: ts(date), type: 3, linked_objects: { propal: 5 } });
    },
  );
});

test("create_invoice warns when Dolibarr does not confirm the proposal link", async () => {
  await withDolibarr(
    [thirdparty, proposal(7), send("POST", /^\/invoices$/, 50), send("POST", /^\/invoices\/50\/lines$/, 1)],
    async () => {
      const result = await callTool("create_invoice", { client: "7", date, proposal: "5", lines: [freeLine] });

      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.linked_to_proposal, false);
      assert.ok(result.warning);
    },
  );
});

test("create_invoice refuses a proposal that belongs to another client", async () => {
  await withDolibarr([thirdparty, proposal(9)], async (requests) => {
    const result = await callTool("create_invoice", { client: "7", date, proposal: "5", lines: [freeLine] });

    assert.equal(result.error, "VALIDATION_ERROR");
    assert.match(result.message, /PR2611-0005/);
    assert.equal(requests.some((r) => r.method === "POST"), false);
  });
});

test("create_invoice reports an unknown proposal before creating anything", async () => {
  await withDolibarr([get(/^\/proposals$/, [])], async (requests) => {
    const result = await callTool("create_invoice", { client: "7", date, proposal: "PR9999-0001", lines: [freeLine] });

    assert.equal(result.error, "PROPOSAL_NOT_FOUND");
    assert.equal(requests.some((r) => r.method === "POST"), false);
  });
});

test("get_invoice_detail shows the invoice type and linked proposals", async () => {
  await withDolibarr(
    [
      thirdparty,
      get(/^\/invoices\/50$/, {
        id: 50, ref: "(PROV50)", socid: 7, type: "3", statut: 0, total_ht: 300, total_ttc: 363, total_tva: 63,
        date: ts(date), linkedObjectsIds: { propal: { "0": 5 } }, lines: [],
      }),
    ],
    async () => {
      const result = await callTool("get_invoice_detail", { invoice: "50" });

      assert.equal(result.type, "deposit");
      assert.deepEqual(result.linked_proposal_ids, [5]);
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, StubError, withDolibarr } from "./helpers/dolibarrStub.js";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL = "http://localhost/api/index.php";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";
const { registerTools } = await import("../../src/server.js");
const server = new McpServer({ name: "list-tools-test", version: "0.0.0" });
registerTools(server);
type Registered = Record<string, {
  inputSchema: { parseAsync(value: unknown): Promise<Record<string, unknown>> };
  handler(args: Record<string, unknown>, extra: unknown): Promise<{ content: Array<{ text: string }> }>;
}>;
const registered = (server as unknown as { _registeredTools: Registered })._registeredTools;
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = registered[name];
  assert.ok(tool, `${name} registered`);
  const result = await tool.handler(await tool.inputSchema.parseAsync(args), {});
  return JSON.parse(result.content[0].text);
}
const customer = { id: 7, name: "Example Company", client: 1, supplier: 0 };
const names = get(/^\/thirdparties\/7$/, customer);
const invoice = (id: number) => ({
  id, ref: `FA-${id}`, socid: "7", statut: "1", date: 1735732800,
  total_ht: "100", total_ttc: "121", date_lim_reglement: 1738324800,
});

test("all six list tools are registered as read-only", () => {
  for (const name of ["list_invoices", "list_proposals", "list_orders", "list_contracts", "list_payments", "list_products"]) {
    assert.ok(registered[name]);
    assert.equal((registered[name] as any).annotations.readOnlyHint, true);
  }
});

test("invoice filters apply server-side and return normalized customer summaries", async () => {
  await withDolibarr([get(/^\/invoices$/, (_m, r) => {
    assert.equal(r.params.get("thirdparty_ids"), "7");
    assert.equal(r.params.get("sqlfilters"), "(t.datef:>=:'2025-01-01') AND (t.datef:<=:'2025-01-31') AND (t.fk_statut:=:1)");
    assert.equal(r.params.get("sortorder"), "DESC");
    return [invoice(9)];
  }), names], async () => {
    const result = await call("list_invoices", { thirdparty_id: 7, status: "validated", date_from: "2025-01-01", date_to: "2025-01-31" });
    assert.equal(result.invoices[0].id, 9);
    assert.equal(result.invoices[0].thirdparty_id, 7);
    assert.equal(result.invoices[0].client_name, "Example Company");
    assert.equal(result.invoices[0].total_including_tax, 121);
    assert.equal(result.has_more, false);
    assert.equal(result.next_offset, null);
  });
});

test("non-aligned offset crosses pages without duplicates and reports lookahead", async () => {
  const all = Array.from({ length: 201 }, (_, i) => invoice(300 - i));
  await withDolibarr([get(/^\/invoices$/, (_m, r) => {
    const start = Number(r.params.get("page")) * Number(r.params.get("limit"));
    return all.slice(start, start + Number(r.params.get("limit")));
  }), names], async (requests) => {
    const result = await call("list_invoices", { offset: 95, limit: 10 });
    assert.deepEqual(result.invoices.map((r: any) => r.id), all.slice(95, 105).map(r => r.id));
    assert.equal(result.has_more, true);
    assert.equal(result.next_offset, 105);
    assert.deepEqual(requests.filter(r => r.path === "/invoices").map(r => r.params.get("page")), ["0", "1"]);
  });
});

test("exact final page and beyond-end offset return accurate pagination", async () => {
  const all = Array.from({ length: 100 }, (_, i) => invoice(100 - i));
  await withDolibarr([get(/^\/invoices$/, (_m, r) => r.params.get("page") === "0" ? all : new StubError(404)), names], async () => {
    const result = await call("list_invoices", { offset: 50, limit: 50 });
    assert.equal(result.count, 50);
    assert.equal(result.has_more, false);
    assert.equal((await call("list_invoices", { offset: 200 })).count, 0);
  });
});

for (const [tool, status, expected] of [
  ["list_invoices", "cancelled", "(t.fk_statut:=:3)"],
  ["list_invoices", "paid", "(t.fk_statut:=:2)"],
  ["list_proposals", "closed", "(t.fk_statut:in:2,3,4)"],
  ["list_proposals", "sent", "(t.fk_statut:=:1)"],
  ["list_orders", "cancelled", "(t.fk_statut:=:-1)"],
]) {
  test(`${tool} maps ${status} to Dolibarr status`, async () => {
    await withDolibarr([get(/^\/(invoices|proposals|orders)$/, (_m, r) => {
      assert.equal(r.params.get("sqlfilters"), expected);
      return [];
    })], async () => { assert.equal((await call(tool, { status })).count, 0); });
  });
}

for (const [tool, field] of [["list_proposals", "datep"], ["list_orders", "date_commande"]]) {
  test(`${tool} uses its actual document date column`, async () => {
    await withDolibarr([get(/^\/(proposals|orders)$/, (_m, r) => {
      assert.equal(r.params.get("sqlfilters"), `(t.${field}:>=:'2025-01-01')`);
      assert.equal(r.params.get("thirdparty_ids"), "7");
      return [];
    })], async () => { await call(tool, { thirdparty_id: 7, date_from: "2025-01-01" }); });
  });
}

test("invalid dates, IDs and page bounds never reach Dolibarr", async () => {
  await withDolibarr([], async () => {
    for (const args of [{ date_from: "2025-02-30" }, { limit: 0 }, { offset: -1 }, { thirdparty_id: 0 }]) {
      await assert.rejects(call("list_invoices", args));
    }
    for (const tool of ["list_invoices", "list_proposals", "list_orders", "list_payments"]) {
      assert.equal((await call(tool, { date_from: "2025-02-01", date_to: "2025-01-01" })).error, "VALIDATION_ERROR");
    }
  });
});

test("catalog browse combines safely quoted ref, label and service filters", async () => {
  await withDolibarr([get(/^\/products$/, (_m, r) => {
    assert.equal(r.params.get("mode"), "2");
    assert.equal(r.params.get("sqlfilters"), "(t.ref:like:'%O''Brien%') AND (t.label:like:'%support%')");
    return [{ id: "5", ref: "SUP", label: "support", type: "1", price: "25", tva_tx: "21" }];
  })], async () => {
    const result = await call("list_products", { ref: "O'Brien", label: "support", type: "service" });
    assert.equal(result.products[0].type, "service");
    assert.equal(result.products[0].price, 25);
  });
});

test("catalog browse without filters includes products and services", async () => {
  await withDolibarr([get(/^\/products$/, (_m, r) => {
    assert.equal(r.params.get("mode"), "0");
    assert.equal(r.params.has("sqlfilters"), false);
    return [];
  })], async () => { await call("list_products"); });
});

test("contracts include undated and closed records without an expiry filter", async () => {
  await withDolibarr([get(/^\/contracts$/, (_m, r) => {
    assert.equal(r.params.get("thirdparty_ids"), "7");
    assert.equal(r.params.has("sqlfilters"), false);
    assert.equal(r.params.get("withLines"), "true");
    return [{ id: 8, ref: "CT-8", socid: 7, statut: 2, lines: [] }];
  }), names], async () => {
    const result = await call("list_contracts", { thirdparty_id: 7 });
    assert.equal(result.contracts[0].status, "closed");
    assert.deepEqual(result.contracts[0].services, []);
  });
});

test("payments filter payment dates on old invoices, exclude discounts and retain split allocations", async () => {
  await withDolibarr([get(/^\/invoices$/, (_m, r) => {
    assert.equal(r.params.get("thirdparty_ids"), "7");
    assert.equal(r.params.has("sqlfilters"), false);
    return [invoice(2), invoice(1)];
  }), get(/^\/invoices\/(\d+)\/payments$/, (m) => [
    { ref: "PAY-1", amount: m[1] === "2" ? "75" : "25", date: "2026-10-20 23:59:59", type: "VIR", typeline: "payment" },
    { ref: "PAY-OLD", amount: "5", date: "2025-01-01", type: "VIR", typeline: "payment" },
    { ref: "CREDIT", amount: "100", date: "2026-10-20", type: "credit", typeline: "discount" },
  ]), names], async () => {
    const result = await call("list_payments", { thirdparty_id: 7, date_from: "2026-10-20", date_to: "2026-10-20" });
    assert.equal(result.count, 2);
    assert.deepEqual(result.payments.map((p: any) => p.amount), [75, 25]);
    assert.ok(result.payments.every((p: any) => p.payment_ref === "PAY-1" && p.date === "2026-10-20"));
    assert.equal(result.scan.complete, true);
  });
});

test("payment scan limits are explicit and continuation skips already scanned invoices", async () => {
  const all = [invoice(3), invoice(2), invoice(1)];
  await withDolibarr([get(/^\/invoices$/, all), get(/^\/invoices\/(\d+)\/payments$/, (m) => [
    { ref: `PAY-${m[1]}`, amount: "10", date: "1792497600", type: "VIR" },
  ]), names], async () => {
    const first = await call("list_payments", { max_invoices: 2, limit: 1 });
    assert.equal(first.payments[0].date, "2026-10-20");
    assert.equal(first.scan.complete, false);
    assert.equal(first.scan.next_invoice_offset, 2);
    assert.equal(first.has_more, true);
    const second = await call("list_payments", { max_invoices: 2, limit: 1, offset: 1 });
    assert.notEqual(second.payments[0].invoice_id, first.payments[0].invoice_id);
    const resumed = await call("list_payments", { max_invoices: 2, invoice_offset: 2 });
    assert.equal(resumed.payments[0].invoice_id, 1);
    assert.equal(resumed.scan.more_invoices_available, false);
    assert.equal(resumed.scan.next_invoice_offset, null);
  });
});

test("payment lookup failures surface instead of returning a partial audit as complete", async () => {
  await withDolibarr([
    get(/^\/invoices$/, [invoice(1)]),
    get(/^\/invoices\/1\/payments$/, new StubError(403)),
  ], async () => {
    const result = await call("list_payments");
    assert.ok(result.error);
    assert.equal(result.scan, undefined);
    assert.equal(result.payments, undefined);
  });
});

for (const tool of ["list_invoices", "list_proposals", "list_orders", "list_contracts", "list_products", "list_payments"]) {
  test(`${tool} returns empty on 404 and surfaces permission errors`, async () => {
    await withDolibarr([get(/^\/(invoices|proposals|orders|contracts|products)$/, new StubError(404))], async () => {
      assert.equal((await call(tool)).count, 0);
    });
    await withDolibarr([get(/^\/(invoices|proposals|orders|contracts|products)$/, new StubError(403))], async () => {
      assert.equal((await call(tool)).error, "DOLIBARR_MODULE_UNAVAILABLE");
    });
  });
}

test("content search resolves a name and restricts each domain before applying scan limits", async () => {
  await withDolibarr([get(/^\/thirdparties$/, [customer]), names,
    get(/^\/(proposals|orders|invoices|supplierinvoices)$/, (_m, r) => {
      assert.equal(r.params.get("thirdparty_ids"), "7");
      assert.equal(r.params.get("limit"), "2");
      return [invoice(1)];
    }), get(/^\/(proposals|orders|invoices|supplierinvoices)\/1$/, {
      ...invoice(1), lines: [{ id: 10, desc: "Example Company maintenance" }],
    })], async () => {
      const result = await call("search_document_content", { query: "maintenance", thirdparty_name: "Example Company", max_documents_per_type: 1 });
      assert.equal(result.match_count, 4);
      assert.ok(result.matches.every((r: any) => r.thirdparty_name === "Example Company"));
    });
});

test("content search ID filter does not require a name search", async () => {
  await withDolibarr([get(/^\/invoices$/, (_m, r) => {
    assert.equal(r.params.get("thirdparty_ids"), "7");
    return [];
  })], async () => {
    assert.equal((await call("search_document_content", { query: "maintenance", thirdparty_id: 7, document_types: ["client_invoice"] })).match_count, 0);
  });
});

test("content search never scans on an ambiguous, missing or conflicting thirdparty", async () => {
  for (const [rows, args, error] of [
    [[customer, { ...customer, id: 8 }], {}, "THIRDPARTY_AMBIGUOUS"],
    [[], {}, "THIRDPARTY_NOT_FOUND"],
    [[customer], { thirdparty_id: 8 }, "VALIDATION_ERROR"],
  ] as const) {
    await withDolibarr([get(/^\/thirdparties$/, rows)], async (requests) => {
      const result = await call("search_document_content", { query: "maintenance", thirdparty_name: "Example Company", ...args });
      assert.equal(result.error, error);
      assert.equal(requests.length, 1);
    });
  }
});

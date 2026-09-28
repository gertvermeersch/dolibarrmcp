import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";

const { mergeLineUpdate } = await import("../../src/dolibarr/documents/lineUpdates.js");
const { DocumentUpdateService } = await import("../../src/dolibarr/documents/documentUpdateService.js");
const { proposalValidityDaysForUpdate, updateProposal } = await import("../../src/dolibarr/proposals.js");
const { updateSupplierInvoiceLine } = await import("../../src/dolibarr/supplierInvoices.js");
const { invoiceHeaderUpdateBody, updateInvoice } = await import("../../src/dolibarr/invoices.js");

type Line = Record<string, unknown> & { id: number };
interface Doc {
  id: number;
  ref?: string;
  statut?: number | string;
  date?: number;
  fin_validite?: number;
  lines?: Line[];
}

// Dolibarr returns line fields as strings; keep that shape in fixtures.
const invoiceLine: Line = {
  id: 1200,
  desc: "Line A",
  label: null,
  qty: "2",
  subprice: "100.00000000",
  tva_tx: "21.000",
  localtax1_tx: "0.000",
  remise_percent: "5",
  product_type: "1",
  fk_product: null,
  date_start: "",
  pa_ht: "40.00000000",
  rang: "1",
};

function fakeService(doc: Doc, options: Partial<ConstructorParameters<typeof DocumentUpdateService<Doc>>[1]> = {}) {
  const calls: [string, ...unknown[]][] = [];
  const service = new DocumentUpdateService<Doc>(
    {
      get: async () => doc,
      updateHeader: async (id, fields) => {
        calls.push(["header", id, fields]);
      },
      addLine: async (id, line) => {
        calls.push(["add", id, line]);
        return 99;
      },
      updateLine: async (id, lineId, line) => {
        calls.push(["update", id, lineId, line]);
      },
      deleteLine: async (id, lineId) => {
        calls.push(["delete", id, lineId]);
      },
    },
    {
      entityLabel: "Invoice",
      reopenTool: "set_invoice_status (status: draft)",
      headerFields: { date: "date", customer_ref: "ref_client" },
      dateFields: ["date"],
      ...options,
    },
  );
  return { service, calls };
}

const noLineEdits = { updateLines: [], addLines: [], removeLineIds: [] };

test("mergeLineUpdate resends existing values and applies only requested changes", () => {
  const payload = mergeLineUpdate(invoiceLine as never, { qty: 3 });

  assert.deepEqual(payload, {
    desc: "Line A",
    qty: 3,
    subprice: "100.00000000",
    tva_tx: "21.000",
    localtax1_tx: "0.000",
    remise_percent: "5",
    product_type: "1",
    date_start: "",
    pa_ht: "40.00000000",
    rang: "1",
  });
});

test("mergeLineUpdate maps tool-facing changes to Dolibarr line fields", () => {
  const payload = mergeLineUpdate(invoiceLine as never, {
    description: "Line B",
    unit_price: 110,
    vat_rate: 6,
    discount_percent: 0,
    product_type: "product",
  });

  assert.equal(payload.desc, "Line B");
  assert.equal(payload.subprice, 110);
  assert.equal(payload.tva_tx, 6);
  assert.equal(payload.remise_percent, 0);
  assert.equal(payload.product_type, 0);
  assert.equal(payload.qty, "2");
});

test("mergeLineUpdate falls back to supplier line description and pu_ht", () => {
  const payload = mergeLineUpdate(
    { id: 373, description: "Sup A", pu_ht: "50.00000000", qty: "2", tva_tx: "21.000" } as never,
    { qty: 4 },
  );

  assert.equal(payload.desc, "Sup A");
  assert.equal(payload.subprice, 50);
  assert.equal(payload.qty, 4);
});

test("refuses to update a non-draft document without writing", async () => {
  const { service, calls } = fakeService({ id: 7, ref: "F0427", statut: "1", lines: [invoiceLine] });
  const result = await service.update(
    { id: 7, ref: "F0427", statut: "1", lines: [invoiceLine] },
    { header: { customer_ref: "PO-1" }, ...noLineEdits },
  );

  assert.equal((result as { error?: string }).error, "NOT_DRAFT");
  assert.match((result as { action: string }).action, /set_invoice_status/);
  assert.deepEqual(calls, []);
});

test("rejects requests without any change", async () => {
  const doc = { id: 7, statut: 0, lines: [invoiceLine] };
  const { service, calls } = fakeService(doc);
  const result = await service.update(doc, {
    header: { date: undefined },
    updateLines: [{ line_id: 1200 }],
    addLines: [],
    removeLineIds: [],
  });

  assert.equal((result as { error?: string }).error, "VALIDATION_ERROR");
  assert.deepEqual(calls, []);
});

test("rejects unknown or duplicated line IDs before any write", async () => {
  const doc = { id: 7, statut: 0, lines: [invoiceLine] };
  const { service, calls } = fakeService(doc);
  const result = await service.update(doc, {
    header: { customer_ref: "PO-1" },
    updateLines: [{ line_id: 1200, qty: 1 }, { line_id: 555, qty: 1 }],
    addLines: [],
    removeLineIds: [1200],
  });

  assert.equal((result as { error?: string }).error, "VALIDATION_ERROR");
  assert.deepEqual(
    (result as { line_errors: { line_id: number }[] }).line_errors.map((error) => error.line_id),
    [555, 1200],
  );
  assert.deepEqual(calls, []);
});

test("rejects invalid dates and unresolvable new lines before any write", async () => {
  const doc = { id: 7, statut: 0, lines: [invoiceLine] };
  const { service, calls } = fakeService(doc);

  const badDate = await service.update(doc, { header: { date: "2026-02-30" }, ...noLineEdits });
  assert.equal((badDate as { error?: string }).error, "VALIDATION_ERROR");

  const badLine = await service.update(doc, {
    header: {},
    updateLines: [],
    addLines: [{ description: "No price", qty: 1 }],
    removeLineIds: [],
  });
  assert.equal((badLine as { error?: string }).error, "VALIDATION_ERROR");
  assert.equal((badLine as { line_errors: unknown[] }).line_errors.length, 1);
  assert.deepEqual(calls, []);
});

test("applies header, line edits, removals, then additions", async () => {
  const lineB: Line = { id: 1201, desc: "Line B", qty: "1", subprice: "10", tva_tx: "21" };
  const doc = { id: 7, statut: 0, lines: [invoiceLine, lineB] };
  const { service, calls } = fakeService(doc);

  const result = await service.update(doc, {
    header: { date: "2026-09-05", customer_ref: "PO-1" },
    updateLines: [{ line_id: 1200, unit_price: 120 }],
    addLines: [{ description: "Extra", qty: 1, unit_price: 5, vat_rate: 21, product_type: "service" }],
    removeLineIds: [1201],
  });

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["header", "update", "delete", "add"],
  );
  assert.deepEqual(calls[0], ["header", 7, { date: Date.UTC(2026, 8, 5, 12) / 1000, ref_client: "PO-1" }]);
  assert.equal((calls[1][3] as { subprice: number }).subprice, 120);
  assert.equal((calls[1][3] as { desc: string }).desc, "Line A");
  assert.deepEqual(calls[2], ["delete", 7, 1201]);
  assert.deepEqual(calls[3][2], { desc: "Extra", qty: 1, subprice: 5, tva_tx: 21, product_type: 1 });

  assert.equal((result as { success?: boolean }).success, true);
  assert.deepEqual((result as { updated_fields: string[] }).updated_fields, ["date", "customer_ref"]);
  assert.deepEqual((result as { updated_line_ids: number[] }).updated_line_ids, [1200]);
  assert.deepEqual((result as { removed_line_ids: number[] }).removed_line_ids, [1201]);
});

test("runs entity header validation against the mapped fields", async () => {
  const doc = { id: 7, statut: 0, lines: [] };
  const { service, calls } = fakeService(doc, {
    validateHeader: (fields) => (fields.ref_client === "bad" ? "bad ref" : undefined),
  });

  const result = await service.update(doc, { header: { customer_ref: "bad" }, ...noLineEdits });
  assert.deepEqual(result, { error: "VALIDATION_ERROR", message: "bad ref" });
  assert.deepEqual(calls, []);
});

// Brussels-midnight timestamps, as Dolibarr returns stored dates.
const sept1 = Date.UTC(2026, 7, 31, 22) / 1000;
const oct1Noon = Date.UTC(2026, 9, 1, 12) / 1000;

test("proposal updates keep the current validity period unless an end date is given", () => {
  const current = { id: 1, ref: "PR1", socid: 1, date: sept1, fin_validite: oct1Noon, total_ht: 0, total_ttc: 0, statut: 0 };

  assert.equal(proposalValidityDaysForUpdate({ note_public: "x" }, current), 30);
  assert.equal(proposalValidityDaysForUpdate({ date: Date.UTC(2026, 8, 10, 12) / 1000 }, current), 30);
  assert.equal(
    proposalValidityDaysForUpdate({ fin_validite: Date.UTC(2026, 9, 31, 12) / 1000 }, current),
    60,
  );
  assert.equal(
    proposalValidityDaysForUpdate({ date: Date.UTC(2026, 8, 10, 12) / 1000, fin_validite: Date.UTC(2026, 8, 5, 12) / 1000 }, current),
    -5,
  );
});

async function captureRequest(run: () => Promise<unknown>): Promise<{ method?: string; url: string; body: unknown }> {
  const originalFetch = globalThis.fetch;
  let captured: { method?: string; url: string; body: unknown } = { url: "", body: undefined };

  globalThis.fetch = async (input, init) => {
    captured = { method: init?.method, url: String(input), body: JSON.parse(String(init?.body)) };
    return new Response("{}", { status: 200 });
  };

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return captured;
}

test("updateProposal always sends duree_validite so Dolibarr keeps the end date", async () => {
  const current = { id: 1, ref: "PR1", socid: 1, date: sept1, fin_validite: oct1Noon, total_ht: 0, total_ttc: 0, statut: 0 };
  const request = await captureRequest(() => updateProposal(1, { note_public: "x" }, current));

  assert.equal(request.method, "PUT");
  assert.match(request.url, /\/proposals\/1$/);
  assert.deepEqual(request.body, { note_public: "x", duree_validite: 30 });
});

test("invoice date changes recompute the due date from the payment terms unless one is given", () => {
  const current = { id: 1, ref: "FA1", socid: 1, date: sept1, date_lim_reglement: oct1Noon, total_ht: 0, total_ttc: 0, total_tva: 0, statut: 0 };
  const newDate = Date.UTC(2026, 8, 10, 12) / 1000;

  assert.deepEqual(invoiceHeaderUpdateBody({ note_public: "x" }, current), { note_public: "x" });
  assert.deepEqual(
    invoiceHeaderUpdateBody({ date: newDate }, { ...current, cond_reglement_id: "2" as unknown as number }),
    { date: newDate, cond_reglement_id: 2 },
  );
  assert.deepEqual(invoiceHeaderUpdateBody({ date: newDate }, current), { date: newDate, date_lim_reglement: newDate });
  assert.deepEqual(
    invoiceHeaderUpdateBody({ date: newDate, date_lim_reglement: oct1Noon }, { ...current, cond_reglement_id: 2 }),
    { date: newDate, date_lim_reglement: oct1Noon },
  );
});

test("updateInvoice posts cond_reglement_id after date so Dolibarr recomputes the due date", async () => {
  const current = { id: 1, ref: "FA1", socid: 1, date: sept1, date_lim_reglement: oct1Noon, cond_reglement_id: 2, total_ht: 0, total_ttc: 0, total_tva: 0, statut: 0 };
  const newDate = Date.UTC(2026, 8, 10, 12) / 1000;
  const request = await captureRequest(() => updateInvoice(1, { date: newDate }, current));

  assert.equal(request.method, "PUT");
  assert.match(request.url, /\/invoices\/1$/);
  assert.deepEqual(Object.keys(request.body as object), ["date", "cond_reglement_id"]);
});

test("updateSupplierInvoiceLine sends supplier field names", async () => {
  const request = await captureRequest(() =>
    updateSupplierInvoiceLine(5, 373, { desc: "Sup A", subprice: 60, qty: 4, tva_tx: 21 }),
  );

  assert.match(request.url, /\/supplierinvoices\/5\/lines\/373$/);
  assert.deepEqual(request.body, {
    desc: "Sup A",
    subprice: 60,
    qty: 4,
    tva_tx: 21,
    description: "Sup A",
    pu_ht: 60,
  });
});

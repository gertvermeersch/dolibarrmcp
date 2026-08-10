import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { markInvoicePaid } = await import(
  "../../src/dolibarr/documents/invoicePaymentService.js"
);

type ResponseSpec = { body?: unknown; status?: number };

function invoice(statut: number, paye = 0) {
  return {
    id: 42,
    ref: "INV-42",
    socid: 7,
    date: 1_700_000_000,
    date_lim_reglement: 1_700_086_400,
    total_ht: 100,
    total_tva: 21,
    total_ttc: 121,
    statut,
    paye,
  };
}

async function withFetchResponses<T>(
  specs: ResponseSpec[],
  run: (requests: Array<{ path: string; method: string; body?: unknown }>) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", body });

    const spec = specs.shift();
    assert.ok(spec, `Unexpected request to ${url.pathname}`);
    const responseBody = spec.body === undefined ? "" : JSON.stringify(spec.body);
    return new Response(responseBody, { status: spec.status ?? 200 });
  };

  try {
    const result = await run(requests);
    assert.equal(specs.length, 0, "Not all mocked responses were used");
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("marks a validated client invoice paid without creating a payment", async () => {
  await withFetchResponses(
    [{ body: invoice(1) }, { body: invoice(2, 1) }, { body: invoice(2, 1) }],
    async (requests) => {
      const result = await markInvoicePaid({ invoiceType: "client", invoiceId: 42 });

      assert.deepEqual(result, {
        success: true,
        invoice_type: "client",
        invoice_id: 42,
        ref: "INV-42",
        status: "paid",
        payment: { action: "none" },
      });
      assert.deepEqual(requests, [
        { path: "/invoices/42?includeLines=1", method: "GET", body: undefined },
        {
          path: "/invoices/42/settopaid",
          method: "POST",
          body: { close_code: "", close_note: "" },
        },
        { path: "/invoices/42?includeLines=1", method: "GET", body: undefined },
      ]);
    },
  );
});

test("creates a supplier payment for the remaining balance and closes atomically", async () => {
  await withFetchResponses(
    [{ body: invoice(1) }, { body: 91 }, { body: invoice(2, 1) }],
    async (requests) => {
      const result = await markInvoicePaid({
        invoiceType: "supplier",
        invoiceId: 42,
        payment: {
          mode: "create",
          date: "2026-08-11",
          paymentModeId: 6,
          accountId: 3,
          number: "TRX-9",
          comment: "Paid by transfer",
        },
      });

      assert.deepEqual(result, {
        success: true,
        invoice_type: "supplier",
        supplier_invoice_id: 42,
        ref: "INV-42",
        status: "paid",
        payment: { action: "created", id: 91, date: "2026-08-11" },
      });
      assert.deepEqual(requests, [
        { path: "/supplierinvoices/42?includeLines=1", method: "GET", body: undefined },
        {
          path: "/supplierinvoices/42/payments",
          method: "POST",
          body: {
            datepaye: Date.UTC(2026, 7, 11, 12) / 1000,
            payment_mode_id: 6,
            accountid: 3,
            num_payment: "TRX-9",
            comment: "Paid by transfer",
            closepaidinvoices: "yes",
          },
        },
        { path: "/supplierinvoices/42?includeLines=1", method: "GET", body: undefined },
      ]);
    },
  );
});

test("verifies an already-linked payment before closing", async () => {
  await withFetchResponses(
    [
      { body: invoice(1) },
      { body: [{ amount: "121.00", date: 1_700_000_000, ref: "PAY-7", type: "VIR" }] },
      { body: invoice(2, 1) },
      { body: invoice(2, 1) },
    ],
    async (requests) => {
      const result = await markInvoicePaid({
        invoiceType: "client",
        invoiceId: 42,
        payment: { mode: "existing", reference: "pay-7" },
      });

      assert.deepEqual(result.payment, {
        action: "existing_link_verified",
        reference: "PAY-7",
        amount: 121,
      });
      assert.equal(requests[1]?.path, "/invoices/42/payments");
      assert.equal(requests[2]?.path, "/invoices/42/settopaid");
    },
  );
});

test("does not close when the requested existing payment is not linked", async () => {
  await withFetchResponses([{ body: invoice(1) }, { body: [] }], async (requests) => {
    const result = await markInvoicePaid({
      invoiceType: "supplier",
      invoiceId: 42,
      payment: { mode: "existing", reference: "PAY-MISSING" },
    });

    assert.equal(result.error, "PAYMENT_NOT_LINKED");
    assert.equal(requests.length, 2);
  });
});

test("is idempotent and never creates a payment for an already-paid invoice", async () => {
  await withFetchResponses([{ body: invoice(2, 1) }], async (requests) => {
    const result = await markInvoicePaid({
      invoiceType: "client",
      invoiceId: 42,
      payment: { mode: "create", paymentModeId: 6, accountId: 3 },
    });

    assert.equal(result.success, true);
    assert.match(String(result.note), /Already paid/);
    assert.equal(requests.length, 1);
  });
});

test("refuses to mark a draft invoice paid", async () => {
  await withFetchResponses([{ body: invoice(0) }], async (requests) => {
    const result = await markInvoicePaid({ invoiceType: "client", invoiceId: 42 });

    assert.equal(result.error, "VALIDATION_ERROR");
    assert.match(String(result.message), /must be validated/);
    assert.equal(requests.length, 1);
  });
});

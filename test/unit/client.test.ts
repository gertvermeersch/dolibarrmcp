import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { DolibarrApiError, isDolibarrModuleUnavailableError, toApiError } = await import("../../src/dolibarr/client.js");

test("normalizes Dolibarr not-found errors without leaking debug payloads", () => {
  const result = toApiError(new DolibarrApiError(
    404,
    "Dolibarr API error 404: raw debug payload",
    "/invoices/99999999/validate",
    {
      error: {
        code: 404,
        message: "Invoice not found",
        debug: { source: "api_invoices.class.php:1157" },
      },
    },
  ));

  assert.deepEqual(result, {
    error: "NOT_FOUND",
    message: "Invoice 99999999 not found.",
  });
  assert.equal(JSON.stringify(result).includes("debug"), false);
  assert.equal(JSON.stringify(result).includes("api_invoices"), false);
});

test("treats duplicate validation as idempotent success", () => {
  assert.deepEqual(
    toApiError(new DolibarrApiError(304, "Dolibarr API error 304: ", "/proposals/42/validate")),
    {
      success: true,
      status: "validated",
      note: "Already validated.",
    },
  );
});

test("maps common Dolibarr validation errors to clean MCP errors", () => {
  assert.deepEqual(
    toApiError(new DolibarrApiError(
      500,
      "Dolibarr API error 500: raw debug payload",
      "/thirdparties",
      { error: { message: "ErrorBadThirdPartyName", debug: { source: "api_thirdparties.class.php:342" } } },
    )),
    {
      error: "VALIDATION_ERROR",
      message: "Thirdparty name is required.",
    },
  );

  assert.deepEqual(
    toApiError(
      new DolibarrApiError(
        500,
        "Dolibarr API error 500: raw debug payload",
        "/supplierinvoices",
        { error: { message: "ErrorRefAlreadyExists", debug: { source: "api_supplierinvoices.class.php" } } },
      ),
      { supplierInvoiceRef: "SUP-123" },
    ),
    {
      error: "DUPLICATE_REF",
      message: "Supplier invoice ref 'SUP-123' already exists for this supplier.",
    },
  );
});

test("maps invoice draft warehouse failures to a clean action", () => {
  assert.deepEqual(
    toApiError(new DolibarrApiError(
      400,
      "Dolibarr API error 400: Invalid value specified for idwarehouse. Expecting integer value",
      "/invoices/538/settodraft",
      { error: { message: "Invalid value specified for idwarehouse. Expecting integer value" } },
    )),
    {
      error: "WAREHOUSE_REQUIRED",
      message: "Dolibarr requires a warehouse when reopening this customer invoice to draft because stock movements may need to be reversed.",
      action: "Pass warehouse_id on this tool call, or set DOLIBARR_DEFAULT_WAREHOUSE_ID for automated invoice reopen flows.",
    },
  );
});

test("maps invoice not-erasable delete failures to a clean action", () => {
  assert.deepEqual(
    toApiError(new DolibarrApiError(
      403,
      "Dolibarr API error 403: Forbidden: Invoice not erasable",
      "/invoices/533",
      { error: { message: "Forbidden: Invoice not erasable" } },
    )),
    {
      error: "INVOICE_NOT_ERASABLE",
      message: "Invoice is not erasable in its current state.",
      action: "Reopen the invoice to draft first, or run delete_invoice with reopen_if_validated:true when this is allowed.",
    },
  );
});

test("detects inactive module errors on known module endpoints", () => {
  const err = new DolibarrApiError(
    403,
    "Dolibarr API error 403: Forbidden",
    "/orders?limit=1",
    { error: { message: "Forbidden" } },
  );

  assert.equal(isDolibarrModuleUnavailableError(err), true);
  assert.deepEqual(toApiError(err), {
    error: "DOLIBARR_MODULE_UNAVAILABLE",
    message: "Dolibarr refused access to the Customer orders API. The module may be inactive or the API user may be missing permissions.",
    action: "Enable the Dolibarr Customer orders module and grant the API user order permissions required by this tool.",
  });
});

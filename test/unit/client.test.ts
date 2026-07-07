import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { DolibarrApiError, toApiError } = await import("../../src/dolibarr/client.js");

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

import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { documentCreationResponse } = await import("../../src/tools/shared/documentCreationResponse.js");

const successResult = {
  success: true as const,
  id: 42,
  thirdparty: "Acme Corp",
  validated: true,
  lines: [{ description: "Consulting" }] as never,
};

test("maps a success result with entity-specific field names", () => {
  const response = documentCreationResponse(successResult, {
    idKey: "invoice_id",
    thirdpartyKey: "client",
  });

  assert.deepEqual(response, {
    success: true,
    invoice_id: 42,
    client: "Acme Corp",
    validated: true,
    lines: [{ description: "Consulting" }],
  });
});

test("places extra fields between thirdparty and validated", () => {
  const response = documentCreationResponse(successResult, {
    idKey: "invoice_id",
    thirdpartyKey: "supplier",
    extra: { supplier_invoice_ref: "SUP-001" },
  }) as Record<string, unknown>;

  assert.deepEqual(Object.keys(response), [
    "success",
    "invoice_id",
    "supplier",
    "supplier_invoice_ref",
    "validated",
    "lines",
  ]);
});

test("returns error results unchanged", () => {
  const error = { error: "VALIDATION_ERROR", message: "bad line" } as const;

  const response = documentCreationResponse(error, {
    idKey: "invoice_id",
    thirdpartyKey: "client",
  });

  assert.equal(response, error);
});

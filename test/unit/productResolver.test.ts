import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { resolveLine } = await import("../../src/resolvers/product.js");

test("passes the selected product type to a free-text line", async () => {
  const result = await resolveLine({
    description: "Consulting",
    product_type: 1,
    qty: 2,
    unit_price: 75,
    vat_rate: 21,
  }, 1);

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected the free-text line to resolve");
  assert.equal(result.resolved.line.product_type, 1);
});

test("defaults an untyped free-text line to product", async () => {
  const result = await resolveLine({
    description: "Hardware",
    qty: 1,
    unit_price: 50,
    vat_rate: 21,
  }, 1);

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected the free-text line to resolve");
  assert.equal(result.resolved.line.product_type, 0);
});

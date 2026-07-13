import assert from "node:assert/strict";
import test from "node:test";
import { getThirdpartyType } from "../../src/dolibarr/thirdpartyType.js";

test("classifies a client-only thirdparty", () => {
  assert.equal(getThirdpartyType({ client: 1, fournisseur: 0 } as never), "client");
});

test("classifies a supplier-only thirdparty", () => {
  assert.equal(getThirdpartyType({ client: 0, fournisseur: 1 } as never), "supplier");
});

test("classifies a thirdparty that is both client and supplier", () => {
  assert.equal(getThirdpartyType({ client: 1, fournisseur: 1 } as never), "both");
});

test("classifies a thirdparty that is neither as other", () => {
  assert.equal(getThirdpartyType({ client: 0, fournisseur: 0 } as never), "other");
});

test("reads the supplier flag from the modern 'supplier' field", () => {
  assert.equal(getThirdpartyType({ client: 0, supplier: 1 } as never), "supplier");
});

test("treats string flags from the API as truthy", () => {
  assert.equal(getThirdpartyType({ client: "1", fournisseur: "0" } as never), "client");
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { updateCatalogItem } = await import("../../src/tools/catalog/catalogUpdate.js");

type Product = Record<string, unknown>;

// Dolibarr returns catalog fields as strings; keep that shape in fixtures.
const service: Product = {
  id: "41",
  ref: "SVC-1",
  label: "Consulting",
  description: "Hourly consulting",
  type: "1",
  price: "100.00000000",
  price_ttc: "121.00000000",
  tva_tx: "21.000",
  status: "1",
  status_buy: "0",
};

function fakeApi(item: Product | undefined, applyUpdate = true) {
  const updates: [number, Record<string, unknown>][] = [];
  let current = item;
  const api = {
    get: async (id: number) => {
      if (!current || Number(current.id) !== id) throw new Error(`unexpected get ${id}`);
      return current as never;
    },
    list: async () => (current ? [current as never] : []),
    update: async (id: number, fields: Record<string, unknown>) => {
      updates.push([id, fields]);
      if (applyUpdate && current) current = { ...current, ...fields };
      return current as never;
    },
  };
  return { api, updates };
}

test("maps tool fields to Dolibarr fields and sends only changed ones", async () => {
  const { api, updates } = fakeApi(service);
  const result = await updateCatalogItem(
    "service",
    { item: "SVC-1", label: "Senior consulting", price: 120, vat_rate: 6, on_sale: false, on_purchase: true },
    api,
  );

  assert.deepEqual(updates, [[41, {
    label: "Senior consulting",
    price: 120,
    tva_tx: 6,
    status: 0,
    status_buy: 1,
    price_base_type: "HT",
  }]]);
  assert.equal((result as { success?: boolean }).success, true);
  assert.equal((result as { service_id?: number }).service_id, 41);
  assert.deepEqual((result as { updated_fields: string[] }).updated_fields, ["label", "price", "vat_rate", "on_sale", "on_purchase"]);
  assert.equal("warnings" in result, false);
  assert.deepEqual((result as { service: Record<string, unknown> }).service, {
    id: 41,
    ref: "SVC-1",
    label: "Senior consulting",
    price: 120,
    vat_rate: 6,
    type: "service",
    description: "Hourly consulting",
    price_including_tax: 121,
    on_sale: false,
    on_purchase: true,
  });
});

test("refuses to update a product through update_service without writing", async () => {
  const { api, updates } = fakeApi({ ...service, type: "0" });
  const result = await updateCatalogItem("service", { item: "41", label: "x" }, api);

  assert.equal((result as { error?: string }).error, "CATALOG_TYPE_MISMATCH");
  assert.match((result as { action: string }).action, /update_product/);
  assert.deepEqual(updates, []);
});

test("returns a kind-specific not-found error", async () => {
  const { api } = fakeApi(undefined);
  const result = await updateCatalogItem("product", { item: "NOPE", label: "x" }, api);

  assert.equal((result as { error?: string }).error, "PRODUCT_NOT_FOUND");
});

test("rejects requests without any change", async () => {
  const { api, updates } = fakeApi(service);
  const result = await updateCatalogItem("service", { item: "SVC-1" }, api);

  assert.deepEqual(result, { error: "VALIDATION_ERROR", message: "No changes requested." });
  assert.deepEqual(updates, []);
});

test("warns when Dolibarr ignores price and VAT changes", async () => {
  const { api } = fakeApi(service, false);
  const result = await updateCatalogItem("service", { item: "SVC-1", price: 150, vat_rate: 6 }, api);

  assert.equal((result as { success?: boolean }).success, true);
  assert.equal((result as { warnings: string[] }).warnings.length, 2);
});

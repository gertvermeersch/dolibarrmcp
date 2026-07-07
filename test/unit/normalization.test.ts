import assert from "node:assert/strict";
import test from "node:test";
import {
  country,
  dolibarrId,
  isIsoDateString,
  isoDateFromTimestamp,
  money,
  remainingToPay,
} from "../../src/tools/shared/normalization.js";
import {
  serializeCatalogItem,
  serializeInvoiceSearchSummary,
  serializeLineItem,
  serializeThirdpartySummary,
} from "../../src/tools/shared/serializers.js";
import type {
  DolibarrInvoice,
  DolibarrInvoiceLine,
  DolibarrProduct,
  DolibarrThirdparty,
} from "../../src/types/dolibarr.js";

test("rounds monetary values from numbers and Dolibarr strings", () => {
  assert.equal(money(3338.7900000000004), 3338.79);
  assert.equal(money("1887.60000000"), 1887.6);
});

test("normalizes Unix timestamps to ISO date strings", () => {
  assert.equal(isoDateFromTimestamp(1778450400), "2026-05-11");
  assert.equal(isoDateFromTimestamp("1778450400"), "2026-05-11");
  assert.equal(isoDateFromTimestamp(Date.UTC(2026, 6, 4, 22) / 1000), "2026-07-05");
});

test("validates date-only input before sending it to Dolibarr", () => {
  assert.equal(isIsoDateString("2026-07-05"), true);
  assert.equal(isIsoDateString("2026-02-31"), false);
  assert.equal(isIsoDateString("2026-7-5"), false);
});

test("keeps Dolibarr IDs numeric when the API returns strings", () => {
  assert.equal(dolibarrId("120"), 120);
});

test("rounds remaining-to-pay calculations before returning them", () => {
  const invoice = {
    id: 1,
    ref: "FA2026-0001",
    socid: 120,
    date: 1778450400,
    date_lim_reglement: 1778450400,
    total_ht: 0,
    total_ttc: 3338.79,
    total_tva: 0,
    statut: 1,
    totalpaid: "0.00",
  } as DolibarrInvoice & Record<string, unknown>;

  assert.equal(remainingToPay(invoice), 3338.79);
});

test("resolves known Dolibarr country IDs to user-facing country data", () => {
  const thirdparty = {
    id: 120,
    name: "Example",
    client: 1,
    supplier: 0,
    country_id: 2,
  } as DolibarrThirdparty;

  assert.deepEqual(country(thirdparty), { code: "BE", name: "Belgium" });
});

test("serializes line items without raw product IDs and with numeric values", () => {
  const line = {
    id: "179",
    fk_product: "5",
    product_ref: "REPAIR",
    product_label: "Example\r\nrepair service",
    desc: "Example\r\nrepair service",
    qty: "2",
    subprice: "40.00000000",
    tva_tx: "0.000",
    total_ht: "80.00000000",
    total_ttc: "80.00000000",
  } as unknown as DolibarrInvoiceLine;

  const serialized = serializeLineItem(line);

  assert.equal(serialized.line_id, 179);
  assert.equal(serialized.product_ref, "REPAIR");
  assert.equal(serialized.label, "Example repair service");
  assert.equal(serialized.qty, 2);
  assert.equal(serialized.unit_price, 40);
  assert.equal(serialized.vat_rate, 0);
  assert.equal(serialized.total_excluding_tax, 80);
  assert.equal(Object.hasOwn(serialized, "product_id"), false);
  assert.equal(Object.hasOwn(serialized, "fk_product"), false);
});

test("serializes catalog items with numeric VAT rates", () => {
  const product = {
    id: "5",
    ref: "EXAMPLE-SERVICE",
    label: "Website package",
    price: "1250.00000000",
    tva_tx: "21.000",
    type: "1",
  } as unknown as DolibarrProduct;

  assert.deepEqual(serializeCatalogItem(product), {
    id: 5,
    ref: "EXAMPLE-SERVICE",
    label: "Website package",
    price: 1250,
    vat_rate: 21,
    type: "service",
  });
});

test("serializes thirdparty summaries without empty code fields", () => {
  const thirdparty = {
    id: "8",
    name: "Example Customer",
    client: 1,
    supplier: 0,
    email: null,
    town: null,
    zip: null,
    code_client: null,
    code_fournisseur: null,
  } as unknown as DolibarrThirdparty;

  const serialized = serializeThirdpartySummary(thirdparty);

  assert.equal(serialized.name, "Example Customer");
  assert.equal(Object.hasOwn(serialized, "code_client"), false);
  assert.equal(Object.hasOwn(serialized, "code_supplier"), false);
  assert.equal(Object.hasOwn(serialized, "email"), false);
  assert.equal(Object.hasOwn(serialized, "town"), false);
  assert.equal(Object.hasOwn(serialized, "zip"), false);
});

test("serializes search document summaries with client names instead of client IDs", () => {
  const invoice = {
    id: "9",
    ref: "FA-TEST-0009",
    socid: "8",
    date: "1778450400",
    date_lim_reglement: "1779055200",
    total_ht: "100.00000000",
    total_ttc: "121.00000000",
    total_tva: "21.00000000",
    statut: "2",
  } as unknown as DolibarrInvoice;

  const serialized = serializeInvoiceSearchSummary(
    invoice,
    "paid",
    new Map([[8, "Example Customer"]]),
  );

  assert.equal(serialized.client_name, "Example Customer");
  assert.equal(serialized.total_excluding_tax, 100);
  assert.equal(serialized.total_including_tax, 121);
  assert.equal(Object.hasOwn(serialized, "client_id"), false);
  assert.equal(Object.hasOwn(serialized, "status_code"), false);
});

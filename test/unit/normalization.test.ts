import assert from "node:assert/strict";
import test from "node:test";
import {
  country,
  dolibarrId,
  isoDateFromTimestamp,
  money,
  remainingToPay,
} from "../../src/tools/shared/normalization.js";
import type { DolibarrInvoice, DolibarrThirdparty } from "../../src/types/dolibarr.js";

test("rounds monetary values from numbers and Dolibarr strings", () => {
  assert.equal(money(3338.7900000000004), 3338.79);
  assert.equal(money("1887.60000000"), 1887.6);
});

test("normalizes Unix timestamps to ISO date strings", () => {
  assert.equal(isoDateFromTimestamp(1778450400), "2026-05-10");
  assert.equal(isoDateFromTimestamp("1778450400"), "2026-05-10");
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

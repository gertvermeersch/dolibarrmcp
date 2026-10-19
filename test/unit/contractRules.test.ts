import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";

const rules = await import("../../src/dolibarr/maintenance/contractRules.js");
const { unixTimestampFromIsoDate } = await import("../../src/tools/shared/normalization.js");

const ts = unixTimestampFromIsoDate;

// Dolibarr returns numeric fields as strings; keep that shape in fixtures.
function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    statut: "4",
    qty: "1",
    subprice: "1200.00000000",
    total_ht: "1200.00000000",
    tva_tx: "21.000",
    date_start: ts("2025-01-01"),
    date_end: ts("2025-12-31"),
    desc: "Hosting",
    ...overrides,
  } as never;
}

test("date helpers add days and months with month-end clamping", () => {
  assert.equal(rules.addDaysIso("2025-12-31", 1), "2026-01-01");
  assert.equal(rules.addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(rules.addMonthsIso("2026-01-01", 12), "2027-01-01");
  assert.equal(rules.addMonthsIso("2026-01-31", 1), "2026-02-28");
  assert.equal(rules.addMonthsIso("2026-11-15", 3), "2027-02-15");
  assert.equal(rules.addMonthsIso("2026-01-15", -12), "2025-01-15");
});

test("daysBetweenIso is negative when the target date is earlier", () => {
  assert.equal(rules.daysBetweenIso("2026-01-01", "2026-01-31"), 30);
  assert.equal(rules.daysBetweenIso("2026-01-31", "2026-01-01"), -30);
  assert.equal(rules.daysBetweenIso("2026-03-28", "2026-03-30"), 2); // across DST change
});

test("periodMonths rounds an inclusive period to whole months", () => {
  assert.equal(rules.periodMonths("2025-01-01", "2025-12-31"), 12);
  assert.equal(rules.periodMonths("2024-01-01", "2024-12-31"), 12); // leap year
  assert.equal(rules.periodMonths("2025-01-01", "2026-12-31"), 24);
  assert.equal(rules.periodMonths("2025-01-01", "2025-01-01"), 1);
});

test("contract end date is the latest line end date", () => {
  const lines = [
    line({ id: 1, date_end: ts("2025-06-30") }),
    line({ id: 2, date_end: ts("2025-12-31") }),
    line({ id: 3, date_end: "" }),
  ];

  assert.equal(rules.contractEndDate(lines), "2025-12-31");
  assert.equal(rules.contractEndDate([line({ date_end: "" })]), undefined);
  assert.equal(rules.contractEndDate([]), undefined);
});

test("a line is expired only when running and past its end date", () => {
  assert.equal(rules.isExpiredLine(line(), "2026-01-01"), true);
  assert.equal(rules.isExpiredLine(line(), "2025-12-31"), false, "the end date itself is still covered");
  assert.equal(rules.isExpiredLine(line({ statut: "5" }), "2026-06-01"), false, "closed lines are not expired");
  assert.equal(rules.isExpiredLine(line({ statut: "0" }), "2026-06-01"), false, "unstarted lines are not expired");
  assert.equal(rules.isExpiredLine(line({ date_end: "" }), "2026-06-01"), false);
});

test("expiryStatus classifies by days to the end date", () => {
  assert.equal(rules.expiryStatus("2026-01-01", "2026-01-02", 60), "expired");
  assert.equal(rules.expiryStatus("2026-01-02", "2026-01-02", 60), "expiring");
  assert.equal(rules.expiryStatus("2026-03-03", "2026-01-02", 60), "expiring");
  assert.equal(rules.expiryStatus("2026-03-04", "2026-01-02", 60), "running");
});

test("contract start prefers the contract date over the earliest line start", () => {
  const withDate = { id: 1, ref: "C", socid: 1, date_contrat: ts("2025-02-01"), lines: [line()] } as never;
  const withoutDate = { id: 1, ref: "C", socid: 1, lines: [line({ date_start: ts("2025-03-01") }), line()] } as never;

  assert.equal(rules.contractStartDate(withDate), "2025-02-01");
  assert.equal(rules.contractStartDate(withoutDate), "2025-01-01");
});

test("annual value sums non-closed lines and scales other periods to a year", () => {
  assert.equal(rules.annualValueExclTax([line(), line({ id: 2, total_ht: "300" })]), 1500);
  assert.equal(rules.annualValueExclTax([line({ statut: "5" })]), 0);
  // 24-month line of 2400 is 1200 a year; a 6-month line of 600 is 1200 a year.
  assert.equal(rules.annualValueExclTax([line({ total_ht: "2400", date_end: ts("2026-12-31") })]), 1200);
  assert.equal(rules.annualValueExclTax([line({ total_ht: "600", date_end: ts("2025-06-30") })]), 1200);
  // A line without a period counts once.
  assert.equal(rules.annualValueExclTax([line({ date_start: "", date_end: "" })]), 1200);
});

test("linkedObjectIds reads object and array shapes and ignores other types", () => {
  const linked = {
    facture: { "0": "12", "1": 15 },
    propal: [3],
    fichinter: ["9"],
  };

  assert.deepEqual(rules.linkedObjectIds(linked, "facture"), [12, 15]);
  assert.deepEqual(rules.linkedObjectIds(linked, "facture", "fichinter"), [12, 15, 9]);
  assert.deepEqual(rules.linkedObjectIds(undefined, "facture"), []);
  assert.deepEqual(rules.linkedObjectIds({ facture: [12, 12] }, "facture"), [12]);
});

test("an invoice counts as a renewal only when dated more than 30 days after the start", () => {
  const invoice = (date: string, statut = 1) => ({ date: ts(date), statut }) as never;

  assert.equal(rules.isRenewalInvoice("2025-01-01", invoice("2025-01-31")), false, "30 days is still the initial invoice");
  assert.equal(rules.isRenewalInvoice("2025-01-01", invoice("2025-02-01")), true);
  assert.equal(rules.isRenewalInvoice("2025-01-01", invoice("2024-12-15")), false);
  assert.equal(rules.isRenewalInvoice("2025-01-01", invoice("2026-01-01", 3)), false, "abandoned invoices do not count");
  assert.equal(rules.isRenewalInvoice("2025-01-01", invoice("2026-01-01", 0)), true, "a draft renewal counts");
  assert.equal(rules.isRenewalInvoice(undefined, invoice("2026-01-01")), false);
  assert.equal(rules.hasRenewalInvoice("2025-01-01", [invoice("2025-01-05"), invoice("2025-12-01")]), true);
  assert.equal(rules.hasRenewalInvoice("2025-01-01", [invoice("2025-01-05")]), false);
});

test("contract term follows the line period and defaults to 12 months", () => {
  assert.equal(rules.contractTermMonths([line()]), 12);
  assert.equal(rules.contractTermMonths([line({ date_end: ts("2026-12-31") })]), 24);
  assert.equal(rules.contractTermMonths([line({ date_start: "" })]), 12);
  assert.equal(rules.contractTermMonths([]), 12);
});

test("next renewal period starts the day after the end date", () => {
  assert.deepEqual(rules.nextRenewalPeriod([line()]), {
    start: "2026-01-01",
    end: "2026-12-31",
    months: 12,
  });
  assert.deepEqual(rules.nextRenewalPeriod([line()], 6), {
    start: "2026-01-01",
    end: "2026-06-30",
    months: 6,
  });
  assert.equal(rules.nextRenewalPeriod([line({ date_end: "" })]), undefined);
});

test("renewal invoice lines price running lines and state the period", () => {
  const period = { start: "2026-01-01", end: "2026-12-31", months: 12 };
  const lines = rules.renewalInvoiceLines(
    [
      line({ id: 1, fk_product: "55", desc: "Hosting", qty: "2", subprice: "600", remise_percent: "10", product_type: "1" }),
      line({ id: 2, statut: "5", desc: "Closed service" }),
      line({ id: 3, fk_product: "0", desc: "", description: "", product_label: "Free text", subprice: "50" }),
    ],
    period,
  );

  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    fk_product: 55,
    desc: "Hosting\nPeriode: 01/01/2026 t/m 31/12/2026",
    qty: 2,
    subprice: 600,
    tva_tx: 21,
    remise_percent: 10,
    product_type: 1,
    date_start: ts("2026-01-01"),
    date_end: ts("2026-12-31"),
  });
  assert.equal(lines[1].fk_product, undefined, "free-text lines carry no product");
  assert.match(String(lines[1].desc), /^Free text\nPeriode: /);
});

test("intervention date comes from the earliest line, duration from the header", () => {
  const intervention = {
    id: 1,
    ref: "FI1",
    socid: 1,
    datec: ts("2025-05-01"),
    duration: "5400",
    lines: [
      { id: 1, date: ts("2025-06-10"), duration: "3600" },
      { id: 2, date: ts("2025-06-02"), duration: "1800" },
    ],
  } as never;

  assert.equal(rules.interventionDate(intervention), "2025-06-02");
  assert.equal(rules.interventionDurationHours(intervention), 1.5);
  assert.equal(rules.interventionDate({ id: 1, ref: "X", socid: 1, datec: ts("2025-05-01") } as never), "2025-05-01");
  assert.equal(
    rules.interventionDurationHours({ id: 1, ref: "X", socid: 1, lines: [{ id: 1, duration: 7200 }] } as never),
    2,
  );
});

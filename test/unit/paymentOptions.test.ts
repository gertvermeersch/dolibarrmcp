import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBankAccount,
  resolvePaymentMode,
} from "../../src/resolvers/paymentOptions.js";
import {
  bankAccountSummary,
  paymentModeSummary,
} from "../../src/dolibarr/documents/paymentOptionSummaries.js";

const modes = [
  { id: "1", code: "CHQ", label: "Cheque" },
  { id: "6", code: "VIR", label: "Bank transfer" },
];

const accounts = [
  {
    id: "1",
    ref: "CASH",
    label: "Cash desk",
    bank: "Office",
    type: "2",
    currency_code: "EUR",
    status: "0",
  },
  {
    id: "3",
    ref: "BELFIUS",
    label: "Belfius test account",
    bank: "Belfius",
    type: "1",
    currency_code: "EUR",
    status: "0",
    iban: "BE12 3456 7890 1234",
  },
];

test("resolves payment modes by ID, code, and unique label text", () => {
  assert.equal(resolvePaymentMode(6, modes).ok, true);

  const byCode = resolvePaymentMode("vir", modes);
  assert.equal(byCode.ok, true);
  if (byCode.ok) assert.equal(byCode.value.id, "6");

  const byLabel = resolvePaymentMode("transfer", modes);
  assert.equal(byLabel.ok, true);
  if (byLabel.ok) assert.equal(byLabel.value.code, "VIR");
});

test("resolves bank accounts by ID, ref, label, and bank name", () => {
  for (const selector of [3, "BELFIUS", "test account", "Belfius"] as const) {
    const result = resolveBankAccount(selector, accounts);
    assert.equal(result.ok, true, `Expected ${selector} to resolve`);
    if (result.ok) assert.equal(result.value.id, "3");
  }
});

test("returns candidates rather than guessing an ambiguous account", () => {
  const result = resolveBankAccount("account", [
    ...accounts,
    { id: "4", ref: "OTHER", label: "Other account", bank: "Other" },
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.error, "BANK_ACCOUNT_AMBIGUOUS");
    assert.equal((result.error.candidates as unknown[]).length, 2);
  }
});

test("serializes useful payment labels while masking account identifiers", () => {
  assert.deepEqual(paymentModeSummary(modes[1]), {
    id: 6,
    code: "VIR",
    label: "Bank transfer",
    available_for: ["client", "supplier"],
  });
  assert.deepEqual(bankAccountSummary(accounts[1]), {
    id: 3,
    ref: "BELFIUS",
    label: "Belfius test account",
    bank_name: "Belfius",
    type: "current",
    currency: "EUR",
    status: "open",
    iban_last4: "1234",
  });
});

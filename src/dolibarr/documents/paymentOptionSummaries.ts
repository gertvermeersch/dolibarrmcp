import type { DolibarrBankAccount, DolibarrPaymentMode } from "../../types/dolibarr.js";
import { bankAccountId } from "../../resolvers/paymentOptions.js";
import { cleanString, compactObject, numberOrUndefined } from "../../tools/shared/normalization.js";

function lastFour(value: unknown): string | undefined {
  const cleaned = cleanString(value)?.replace(/\s+/g, "");
  return cleaned ? cleaned.slice(-4) : undefined;
}

function bankAccountType(value: unknown): string | undefined {
  const type = numberOrUndefined(value);
  return type === 0 ? "savings" : type === 1 ? "current" : type === 2 ? "cash" : undefined;
}

export function paymentModeAvailability(
  mode: DolibarrPaymentMode,
): Array<"client" | "supplier"> {
  const type = numberOrUndefined(mode.type);
  if (type === 0) return ["client"];
  if (type === 1) return ["supplier"];
  return ["client", "supplier"];
}

export function paymentModeSummary(mode: DolibarrPaymentMode): Record<string, unknown> {
  return compactObject({
    id: numberOrUndefined(mode.id),
    code: cleanString(mode.code),
    label: cleanString(mode.label),
    type: numberOrUndefined(mode.type),
    available_for: paymentModeAvailability(mode),
  });
}

export function bankAccountSummary(account: DolibarrBankAccount): Record<string, unknown> {
  const closed = numberOrUndefined(account.status ?? account.clos) === 1;
  return compactObject({
    id: bankAccountId(account),
    ref: cleanString(account.ref),
    label: cleanString(account.label),
    bank_name: cleanString(account.bank),
    type: bankAccountType(account.type),
    currency: cleanString(account.currency_code),
    status: closed ? "closed" : "open",
    iban_last4: lastFour(account.iban ?? account.iban_prefix),
    account_number_last4: lastFour(account.number),
    accounting_code: cleanString(account.account_number),
  });
}

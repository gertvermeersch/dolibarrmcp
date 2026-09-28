import type { DolibarrBankAccount, DolibarrPaymentMode } from "../types/dolibarr.js";

export type PaymentOptionSelector = number | string;

type ResolveResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Record<string, unknown> };

function numericId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function bankAccountId(account: DolibarrBankAccount): number | undefined {
  return numericId(account.id ?? account.rowid);
}

function normalized(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().toLowerCase();
  return result || undefined;
}

function matchingValues(values: unknown[], query: string, exact: boolean): boolean {
  return values.some((value) => {
    const candidate = normalized(value);
    return candidate && (exact ? candidate === query : candidate.includes(query));
  });
}

export function resolvePaymentMode(
  selector: PaymentOptionSelector,
  modes: DolibarrPaymentMode[],
): ResolveResult<DolibarrPaymentMode> {
  const selectorId = typeof selector === "number" || /^\d+$/.test(selector.trim())
    ? numericId(selector)
    : undefined;
  if (selectorId !== undefined) {
    const mode = modes.find((candidate) => numericId(candidate.id) === selectorId);
    return mode
      ? { ok: true, value: mode }
      : {
          ok: false,
          error: {
            error: "PAYMENT_MODE_NOT_FOUND",
            message: `No active payment mode found with ID ${selectorId}.`,
            action: "Run list_payment_modes and choose one of the returned IDs, codes, or labels.",
          },
        };
  }

  const query = normalized(selector);
  if (!query) {
    return {
      ok: false,
      error: { error: "PAYMENT_MODE_NOT_FOUND", message: "Payment mode cannot be empty." },
    };
  }

  const exact = modes.filter((mode) => matchingValues([mode.code, mode.label], query, true));
  const matches = exact.length > 0
    ? exact
    : modes.filter((mode) => matchingValues([mode.code, mode.label], query, false));

  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (matches.length === 0) {
    return {
      ok: false,
      error: {
        error: "PAYMENT_MODE_NOT_FOUND",
        message: `No active payment mode found matching '${selector}'.`,
        action: "Run list_payment_modes and choose one of the returned IDs, codes, or labels.",
      },
    };
  }

  return {
    ok: false,
    error: {
      error: "PAYMENT_MODE_AMBIGUOUS",
      message: `Multiple payment modes match '${selector}'.`,
      candidates: matches.map((mode) => ({
        id: numericId(mode.id),
        code: mode.code,
        label: mode.label,
      })),
      action: "Pass an exact payment mode code or ID.",
    },
  };
}

export function resolveBankAccount(
  selector: PaymentOptionSelector,
  accounts: DolibarrBankAccount[],
): ResolveResult<DolibarrBankAccount> {
  const selectorId = typeof selector === "number" || /^\d+$/.test(selector.trim())
    ? numericId(selector)
    : undefined;
  if (selectorId !== undefined) {
    const account = accounts.find((candidate) => bankAccountId(candidate) === selectorId);
    return account
      ? { ok: true, value: account }
      : {
          ok: false,
          error: {
            error: "BANK_ACCOUNT_NOT_FOUND",
            message: `No open bank account found with ID ${selectorId}.`,
            action: "Run list_bank_accounts and choose one of the returned IDs, refs, labels, or bank names.",
          },
        };
  }

  const query = normalized(selector);
  if (!query) {
    return {
      ok: false,
      error: { error: "BANK_ACCOUNT_NOT_FOUND", message: "Bank account cannot be empty." },
    };
  }

  const values = (account: DolibarrBankAccount) => [
    account.ref,
    account.label,
    account.bank,
    account.iban,
    account.iban_prefix,
    account.number,
  ];
  const exact = accounts.filter((account) => matchingValues(values(account), query, true));
  const matches = exact.length > 0
    ? exact
    : accounts.filter((account) => matchingValues(values(account), query, false));

  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (matches.length === 0) {
    return {
      ok: false,
      error: {
        error: "BANK_ACCOUNT_NOT_FOUND",
        message: `No open bank account found matching '${selector}'.`,
        action: "Run list_bank_accounts and choose one of the returned IDs, refs, labels, or bank names.",
      },
    };
  }

  return {
    ok: false,
    error: {
      error: "BANK_ACCOUNT_AMBIGUOUS",
      message: `Multiple bank accounts match '${selector}'.`,
      candidates: matches.map((account) => ({
        id: bankAccountId(account),
        ref: account.ref,
        label: account.label,
        bank_name: account.bank,
        currency: account.currency_code,
      })),
      action: "Pass an exact bank account ref or ID.",
    },
  };
}

import type { DolibarrInvoice, DolibarrThirdparty } from "../../types/dolibarr.js";

type CountryFields = DolibarrThirdparty & Record<string, unknown>;

const knownCountriesById: Record<number, { code: string; name: string }> = {
  2: { code: "BE", name: "Belgium" },
};

export function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function numberOrZero(value: unknown): number {
  return numberOrUndefined(value) ?? 0;
}

export function dolibarrId(value: unknown): number {
  const id = numberOrUndefined(value);
  if (id === undefined) {
    throw new Error(`Invalid Dolibarr ID '${String(value)}'.`);
  }
  return id;
}

export function money(value: unknown): number | undefined {
  const amount = numberOrUndefined(value);
  if (amount === undefined) return undefined;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function moneyOrZero(value: unknown): number {
  return money(value) ?? 0;
}

export function isoDateFromTimestamp(value: unknown): string | undefined {
  const timestamp = numberOrUndefined(value);
  if (timestamp === undefined || timestamp <= 0) return undefined;

  const milliseconds = Math.abs(timestamp) > 99_999_999_999 ? timestamp : timestamp * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

export function isoInstantFromTimestamp(value: unknown): string | undefined {
  const timestamp = numberOrUndefined(value);
  if (timestamp === undefined || timestamp <= 0) return undefined;

  const milliseconds = Math.abs(timestamp) > 99_999_999_999 ? timestamp : timestamp * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function isPaidInvoice(invoice: DolibarrInvoice): boolean {
  const rawInvoice = invoice as DolibarrInvoice & Record<string, unknown>;
  return Number(invoice.statut) === 2 || Number(rawInvoice.paye ?? 0) === 1;
}

export function remainingToPay(invoice: DolibarrInvoice): number {
  if (isPaidInvoice(invoice)) return 0;

  const rawInvoice = invoice as DolibarrInvoice & Record<string, unknown>;
  const explicitRemaining = money(rawInvoice.remaintopay ?? rawInvoice.remaining_to_pay);
  if (explicitRemaining !== undefined) return explicitRemaining;

  const amountPaid = money(rawInvoice.totalpaid ?? rawInvoice.total_paye) ?? 0;
  return money(Math.max(0, numberOrZero(invoice.total_ttc) - amountPaid)) ?? 0;
}

export function country(thirdparty: DolibarrThirdparty): { code?: string; name?: string } | undefined {
  const raw = thirdparty as CountryFields;
  const code = stringOrUndefined(raw.country_code ?? raw.country_code_iso ?? raw.code_pays);
  const name = stringOrUndefined(raw.country ?? raw.country_label ?? raw.country_name ?? raw.libelle_pays ?? raw.pays);

  if (code || name) {
    return { code, name };
  }

  const countryId = numberOrUndefined(thirdparty.country_id);
  if (countryId === undefined) return undefined;
  return knownCountriesById[countryId];
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

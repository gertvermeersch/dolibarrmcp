import {
  isoDateFromTimestamp,
  money,
  numberOrUndefined,
  numberOrZero,
  unixTimestampFromIsoDate,
} from "../../tools/shared/normalization.js";
import type {
  DolibarrContract,
  DolibarrContractLine,
  DolibarrIntervention,
  DolibarrInvoice,
  DolibarrInvoiceLine,
  DolibarrLinkedObjectIds,
} from "../../types/dolibarr.js";

// Pure derivations for maintenance contracts. Dolibarr gives a contract no end
// date of its own, so everything here works from the lines. All dates are
// YYYY-MM-DD strings and "today" is passed in, which keeps these testable.

// Contract line statuses (ContratLigne::STATUS_*).
export const LINE_STATUS_INITIAL = 0;
export const LINE_STATUS_RUNNING = 4;
export const LINE_STATUS_CLOSED = 5;

// Invoice status 3 = abandoned.
const INVOICE_STATUS_ABANDONED = 3;

// A linked invoice dated further than this after the contract start counts as a
// renewal; anything earlier is the initial invoice.
export const RENEWAL_MIN_DAYS_AFTER_START = 30;

const msPerDay = 86_400_000;
const daysPerMonth = 30.4375;

export type ExpiryStatus = "expired" | "expiring" | "running";

function utcMs(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoFromParts(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return isoDateFromTimestamp(Math.floor(now.getTime() / 1000)) ?? now.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(utcMs(iso) + days * msPerDay).toISOString().slice(0, 10);
}

// Adds calendar months and clamps to the last day of shorter months
// (31 January + 1 month = 28 February).
export function addMonthsIso(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return isoFromParts(targetYear, targetMonth, Math.min(day, lastDay));
}

// Calendar days from `from` to `to`; negative when `to` is earlier.
export function daysBetweenIso(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / msPerDay);
}

// Whole months in an inclusive period, at least 1.
export function periodMonths(startIso: string, endIso: string): number {
  return Math.max(1, Math.round((daysBetweenIso(startIso, endIso) + 1) / daysPerMonth));
}

export function formatDateNl(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function lineStatus(line: DolibarrContractLine): number | undefined {
  return numberOrUndefined(line.statut ?? line.status);
}

export function lineStartDate(line: DolibarrContractLine): string | undefined {
  return isoDateFromTimestamp(line.date_start);
}

export function lineEndDate(line: DolibarrContractLine): string | undefined {
  return isoDateFromTimestamp(line.date_end);
}

export function isRunningLine(line: DolibarrContractLine): boolean {
  return lineStatus(line) === LINE_STATUS_RUNNING;
}

// A running service whose planned end date has passed.
export function isExpiredLine(line: DolibarrContractLine, today: string): boolean {
  const end = lineEndDate(line);
  return isRunningLine(line) && end !== undefined && end < today;
}

export function runningLines(lines: DolibarrContractLine[] = []): DolibarrContractLine[] {
  return lines.filter(isRunningLine);
}

export function hasRunningServices(lines: DolibarrContractLine[] = []): boolean {
  return lines.some(isRunningLine);
}

// The latest planned end date over all lines.
export function contractEndDate(lines: DolibarrContractLine[] = []): string | undefined {
  const ends = lines.map(lineEndDate).filter((date): date is string => date !== undefined);
  return ends.length > 0 ? ends.reduce((latest, date) => (date > latest ? date : latest)) : undefined;
}

// Contract date, falling back to the earliest line start.
export function contractStartDate(contract: DolibarrContract): string | undefined {
  const contractDate = isoDateFromTimestamp(contract.date_contrat);
  if (contractDate) return contractDate;

  const starts = (contract.lines ?? [])
    .map(lineStartDate)
    .filter((date): date is string => date !== undefined);
  return starts.length > 0 ? starts.reduce((earliest, date) => (date < earliest ? date : earliest)) : undefined;
}

export function expiryStatus(endDate: string, today: string, daysAhead: number): ExpiryStatus {
  const days = daysBetweenIso(today, endDate);
  if (days < 0) return "expired";
  return days <= daysAhead ? "expiring" : "running";
}

// Length of the contract in whole months, from the earliest line start to the
// latest line end. Defaults to 12 when the lines carry no usable period.
export function contractTermMonths(lines: DolibarrContractLine[] = []): number {
  const end = contractEndDate(lines);
  const starts = lines.map(lineStartDate).filter((date): date is string => date !== undefined);
  if (!end || starts.length === 0) return 12;

  const start = starts.reduce((earliest, date) => (date < earliest ? date : earliest));
  return end < start ? 12 : periodMonths(start, end);
}

// Yearly value excl. VAT of the lines that have not been closed. A line whose
// period is not 12 months is scaled to a year; lines without a period count once.
export function annualValueExclTax(lines: DolibarrContractLine[] = []): number {
  let total = 0;

  for (const line of lines) {
    if (lineStatus(line) === LINE_STATUS_CLOSED) continue;

    const lineTotal = numberOrUndefined(line.total_ht)
      ?? numberOrZero(line.qty) * numberOrZero(line.subprice);
    const start = lineStartDate(line);
    const end = lineEndDate(line);
    const months = start && end && end >= start ? periodMonths(start, end) : 12;
    total += months === 12 ? lineTotal : (lineTotal * 12) / months;
  }

  return money(total) ?? 0;
}

// IDs of linked objects of the given Dolibarr element types, such as `facture`.
export function linkedObjectIds(
  linked: DolibarrLinkedObjectIds | undefined,
  ...types: string[]
): number[] {
  const ids = new Set<number>();

  for (const type of types) {
    const entry = linked?.[type];
    if (!entry) continue;

    for (const value of Array.isArray(entry) ? entry : Object.values(entry)) {
      const id = numberOrUndefined(value);
      if (id !== undefined && id > 0) ids.add(id);
    }
  }

  return [...ids];
}

// A linked invoice dated more than 30 days after the contract start is a
// renewal. Abandoned invoices never count: they were cancelled.
export function isRenewalInvoice(
  contractStart: string | undefined,
  invoice: Pick<DolibarrInvoice, "date" | "statut">,
): boolean {
  if (!contractStart) return false;
  if (numberOrUndefined(invoice.statut) === INVOICE_STATUS_ABANDONED) return false;

  const invoiceDate = isoDateFromTimestamp(invoice.date);
  return invoiceDate !== undefined && daysBetweenIso(contractStart, invoiceDate) > RENEWAL_MIN_DAYS_AFTER_START;
}

export function hasRenewalInvoice(
  contractStart: string | undefined,
  invoices: Array<Pick<DolibarrInvoice, "date" | "statut">>,
): boolean {
  return invoices.some((invoice) => isRenewalInvoice(contractStart, invoice));
}

export interface RenewalPeriod {
  start: string;
  end: string;
  months: number;
}

// The period after the current end date, as long as the contract term unless
// `months` overrides it. Undefined when no line has an end date.
export function nextRenewalPeriod(
  lines: DolibarrContractLine[],
  months?: number,
): RenewalPeriod | undefined {
  const currentEnd = contractEndDate(lines);
  if (!currentEnd) return undefined;

  const length = months ?? contractTermMonths(lines);
  const start = addDaysIso(currentEnd, 1);
  return { start, end: addDaysIso(addMonthsIso(start, length), -1), months: length };
}

export function renewalPeriodText(period: RenewalPeriod): string {
  return `Periode: ${formatDateNl(period.start)} t/m ${formatDateNl(period.end)}`;
}

export function contractLineLabel(line: DolibarrContractLine): string {
  return [line.product_label, line.desc, line.description, line.product_ref]
    .map((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""))
    .find((value) => value.length > 0) ?? "Service";
}

// One invoice line per running contract line, priced as on the contract, with
// the renewal period in the description and as the line's service dates.
export function renewalInvoiceLines(
  lines: DolibarrContractLine[],
  period: RenewalPeriod,
): Partial<DolibarrInvoiceLine>[] {
  const periodText = renewalPeriodText(period);

  return runningLines(lines).map((line) => {
    const baseDescription = [line.desc, line.description]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find((value) => value.length > 0) ?? contractLineLabel(line);
    const productId = numberOrUndefined(line.fk_product);

    return {
      ...(productId !== undefined && productId > 0 ? { fk_product: productId } : {}),
      desc: `${baseDescription}\n${periodText}`,
      qty: numberOrZero(line.qty),
      subprice: numberOrZero(line.subprice),
      tva_tx: numberOrZero(line.tva_tx),
      remise_percent: numberOrZero(line.remise_percent),
      product_type: numberOrUndefined(line.product_type) ?? 1,
      date_start: unixTimestampFromIsoDate(period.start),
      date_end: unixTimestampFromIsoDate(period.end),
    };
  });
}

// An intervention is dated by its earliest line; the header dates are the fallback.
export function interventionDate(intervention: DolibarrIntervention): string | undefined {
  const lineDates = (intervention.lines ?? [])
    .map((line) => isoDateFromTimestamp(line.date))
    .filter((date): date is string => date !== undefined);
  if (lineDates.length > 0) return lineDates.reduce((earliest, date) => (date < earliest ? date : earliest));

  return isoDateFromTimestamp(intervention.dateo) ?? isoDateFromTimestamp(intervention.datec);
}

// Total duration in hours, from the header or else the sum of the lines.
export function interventionDurationHours(intervention: DolibarrIntervention): number {
  const lineSeconds = (intervention.lines ?? []).reduce((sum, line) => sum + numberOrZero(line.duration), 0);
  const seconds = numberOrUndefined(intervention.duration) || lineSeconds;
  return money(seconds / 3600) ?? 0;
}

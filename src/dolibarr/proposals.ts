import { dolibarr } from "./client.js";
import { isDolibarrNotFoundError } from "./errors.js";
import type { DolibarrProposal, DolibarrInvoiceLine } from "../types/dolibarr.js";
import { isoDateFromTimestamp } from "../tools/shared/normalization.js";

export const DEFAULT_PROPOSAL_VALIDITY_DAYS = 30;

export async function listProposals(params: string): Promise<DolibarrProposal[]> {
  try {
    return await dolibarr.get<DolibarrProposal[]>(`/proposals?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

export async function createProposal(data: {
  socid: number;
  date: number;
  duree_validite?: number;
  lines?: Partial<DolibarrInvoiceLine>[];
}): Promise<number> {
  return dolibarr.post<number>("/proposals", {
    duree_validite: DEFAULT_PROPOSAL_VALIDITY_DAYS,
    ...data,
  });
}

export async function addProposalLine(
  proposalId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<number> {
  return dolibarr.post<number>(`/proposals/${proposalId}/line`, line);
}

/**
 * Whole calendar days between a proposal date and its end of validity, both as
 * Dolibarr timestamps. Returns undefined when either date is missing.
 */
export function proposalValidityDays(date: unknown, validUntil: unknown): number | undefined {
  const start = isoDateFromTimestamp(date);
  const end = isoDateFromTimestamp(validUntil);
  if (!start || !end) return undefined;

  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
}

/**
 * Validity period to send with a proposal header update. A new end date sets
 * the period from the (new or current) proposal date; otherwise the current
 * period is kept, so moving the date moves the end date with it.
 */
export function proposalValidityDaysForUpdate(
  fields: Record<string, unknown>,
  current: DolibarrProposal,
): number | undefined {
  return fields.fin_validite !== undefined
    ? proposalValidityDays(fields.date ?? current.date, fields.fin_validite)
    : proposalValidityDays(current.date, current.fin_validite);
}

export async function updateProposal(
  proposalId: number,
  fields: Record<string, unknown>,
  current: DolibarrProposal,
): Promise<DolibarrProposal> {
  // Propal::update() recomputes fin_validite as date + duree_validite, and a
  // fetched proposal carries the PROPALE_VALIDITY_DURATION default rather than
  // its real duration. Always send the intended duration, or any header update
  // silently moves the end date. Verified on Dolibarr 24.0.0.
  const validityDays = proposalValidityDaysForUpdate(fields, current);

  return dolibarr.put<DolibarrProposal>(`/proposals/${proposalId}`, {
    ...fields,
    ...(validityDays !== undefined ? { duree_validite: validityDays } : {}),
  });
}

export async function updateProposalLine(
  proposalId: number,
  lineId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<void> {
  await dolibarr.put(`/proposals/${proposalId}/lines/${lineId}`, line);
}

export async function deleteProposalLine(proposalId: number, lineId: number): Promise<void> {
  await dolibarr.delete(`/proposals/${proposalId}/lines/${lineId}`);
}

export async function validateProposal(
  proposalId: number,
  options: { notrigger?: number } = {},
): Promise<void> {
  await dolibarr.post(`/proposals/${proposalId}/validate`, { notrigger: options.notrigger ?? 0 });
}

export async function closeProposal(
  proposalId: number,
  status: "accepted" | "refused",
  options: {
    note_private?: string;
    note_public?: string;
    notrigger?: number;
  } = {},
): Promise<void> {
  await dolibarr.post(`/proposals/${proposalId}/close`, {
    status: status === "accepted" ? 2 : 3,
    ...options,
  });
}

export async function setProposalDraft(proposalId: number): Promise<DolibarrProposal> {
  return dolibarr.post<DolibarrProposal>(`/proposals/${proposalId}/settodraft`, {});
}

export async function getProposal(id: number): Promise<DolibarrProposal> {
  return dolibarr.get<DolibarrProposal>(`/proposals/${id}?includeLines=1`);
}

export async function deleteProposal(id: number): Promise<void> {
  await dolibarr.delete<void>(`/proposals/${id}`);
}

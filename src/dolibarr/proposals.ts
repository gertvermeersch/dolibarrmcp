import { dolibarr, isDolibarrNotFoundError } from "./client.js";
import type { DolibarrProposal, DolibarrInvoiceLine } from "../types/dolibarr.js";

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
  date: string;
  lines?: Partial<DolibarrInvoiceLine>[];
}): Promise<number> {
  return dolibarr.post<number>("/proposals", data);
}

export async function addProposalLine(
  proposalId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<number> {
  return dolibarr.post<number>(`/proposals/${proposalId}/line`, line);
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

export async function getProposal(id: number): Promise<DolibarrProposal> {
  return dolibarr.get<DolibarrProposal>(`/proposals/${id}?includeLines=1`);
}

export async function deleteProposal(id: number): Promise<void> {
  await dolibarr.delete<void>(`/proposals/${id}`);
}

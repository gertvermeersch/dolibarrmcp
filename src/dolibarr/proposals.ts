import { dolibarr } from "./client.js";
import type { DolibarrProposal, DolibarrInvoiceLine } from "../types/dolibarr.js";

export async function createProposal(data: {
  socid: number;
  date: number;
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

export async function validateProposal(proposalId: number): Promise<void> {
  await dolibarr.post(`/proposals/${proposalId}/validate`, { notrigger: 0 });
}

export async function closeProposal(
  proposalId: number,
  status: "accepted" | "refused",
  note?: string,
): Promise<void> {
  await dolibarr.post(`/proposals/${proposalId}/close`, { status, note });
}

export async function getProposal(id: number): Promise<DolibarrProposal> {
  return dolibarr.get<DolibarrProposal>(`/proposals/${id}?includeLines=1`);
}

export async function deleteProposal(id: number): Promise<void> {
  await dolibarr.delete<void>(`/proposals/${id}`);
}

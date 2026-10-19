import { mapWithConcurrency } from "../concurrency.js";
import { getContract, listAllContracts } from "../contracts.js";
import { DolibarrApiError, isDolibarrNotFoundError } from "../errors.js";
import { getInvoice } from "../invoices.js";
import { listAllInterventions } from "../interventions.js";
import { numberOrUndefined } from "../../tools/shared/normalization.js";
import { statusCode } from "../../tools/shared/deleteGuards.js";
import type {
  DolibarrContract,
  DolibarrIntervention,
  DolibarrInvoice,
} from "../../types/dolibarr.js";
import {
  addMonthsIso,
  contractEndDate,
  contractStartDate,
  daysBetweenIso,
  expiryStatus,
  hasRenewalInvoice,
  hasRunningServices,
  interventionDate,
  linkedObjectIds,
  type ExpiryStatus,
} from "./contractRules.js";

// Interventions with this status are done (Fichinter::STATUS_CLOSED).
export const INTERVENTION_STATUS_DONE = 3;

// Concurrent per-contract lookups; the volumes are small, this just stays polite.
const lookupConcurrency = 4;

// Window used to classify contracts as "expiring" outside list_contracts_by_expiry.
export const defaultExpiryWindowDays = 60;

export const maintenanceLookbackMonths = 12;

// Contract refs by ID, for labelling records that only carry a contract ID.
// Contracts that no longer exist are left out.
export async function loadContractRefs(contractIds: number[]): Promise<Map<number, string>> {
  const contracts = await mapWithConcurrency([...new Set(contractIds)], lookupConcurrency, async (id) => {
    try {
      return await getContract(id);
    } catch (err) {
      if (isDolibarrNotFoundError(err)) return undefined;
      throw err;
    }
  });

  return new Map(contracts.flatMap((contract) => (contract ? [[Number(contract.id), contract.ref] as [number, string]] : [])));
}

export interface InterventionsResult {
  interventions: DolibarrIntervention[];
  /** False when the API user cannot read interventions (module off or no rights). */
  available: boolean;
}

// Contract answers stay useful without interventions, so a 403 from the
// interventions API (module inactive or no rights) degrades to "unavailable"
// instead of failing the whole call.
async function optionalInterventions(
  load: () => Promise<DolibarrIntervention[]>,
): Promise<InterventionsResult> {
  try {
    return { interventions: await load(), available: true };
  } catch (err) {
    if (err instanceof DolibarrApiError && err.status === 403) return { interventions: [], available: false };
    throw err;
  }
}

export interface ContractWithInvoices {
  contract: DolibarrContract;
  invoices: DolibarrInvoice[];
}

// GET /contracts/{id} is the only call that carries linkedObjectsIds, so linked
// invoices are always fetched per contract.
export async function loadContractWithInvoices(contractId: number): Promise<ContractWithInvoices> {
  return withLinkedInvoices(await getContract(contractId));
}

export async function withLinkedInvoices(contract: DolibarrContract): Promise<ContractWithInvoices> {
  const invoiceIds = linkedObjectIds(contract.linkedObjectsIds, "facture");
  const invoices = await mapWithConcurrency(invoiceIds, lookupConcurrency, (id) => getInvoice(id));
  return { contract, invoices };
}

export interface ContractExpiryEntry extends ContractWithInvoices {
  endDate: string;
  daysUntilEnd: number;
  status: ExpiryStatus;
  renewalInvoiced: boolean;
}

export interface ContractExpiryQuery {
  daysAhead: number;
  includeExpired: boolean;
  thirdpartyId?: number;
  onlyWithoutRenewal?: boolean;
  today: string;
}

/**
 * Contracts that are running services and end within `daysAhead` days, or have
 * already ended, sorted by end date. Contracts without running services
 * (drafts, fully closed) and contracts without any line end date are left out:
 * they have nothing to expire.
 */
export async function listContractsByExpiry(query: ContractExpiryQuery): Promise<ContractExpiryEntry[]> {
  const contracts = await listAllContracts({ thirdpartyId: query.thirdpartyId });

  const candidates = contracts.flatMap((contract) => {
    if (!hasRunningServices(contract.lines)) return [];

    const endDate = contractEndDate(contract.lines);
    if (!endDate) return [];

    const status = expiryStatus(endDate, query.today, query.daysAhead);
    if (status === "running") return [];
    if (status === "expired" && !query.includeExpired) return [];

    return [{ contract, endDate, status }];
  });

  const entries = await mapWithConcurrency(candidates, lookupConcurrency, async (candidate) => {
    const loaded = await loadContractWithInvoices(Number(candidate.contract.id));
    return {
      ...loaded,
      endDate: candidate.endDate,
      daysUntilEnd: daysBetweenIso(query.today, candidate.endDate),
      status: candidate.status,
      renewalInvoiced: hasRenewalInvoice(contractStartDate(loaded.contract), loaded.invoices),
    };
  });

  return entries
    .filter((entry) => !query.onlyWithoutRenewal || !entry.renewalInvoiced)
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.contract.ref.localeCompare(b.contract.ref));
}

export interface ContractDetailBundle extends ContractWithInvoices, InterventionsResult {}

// Contract with its linked invoices and the interventions that reference it
// through fk_contrat.
export async function loadContractDetail(contract: DolibarrContract): Promise<ContractDetailBundle> {
  const [withInvoices, interventions] = await Promise.all([
    withLinkedInvoices(contract),
    optionalInterventions(() => listAllInterventions({ contractId: Number(contract.id) })),
  ]);

  return { ...withInvoices, ...interventions };
}

export interface InterventionQuery {
  thirdpartyId?: number;
  contractId?: number;
  from?: string;
  to?: string;
  status?: number;
}

export async function queryInterventions(query: InterventionQuery): Promise<DolibarrIntervention[]> {
  const interventions = await listAllInterventions({
    thirdpartyId: query.thirdpartyId,
    contractId: query.contractId,
  });

  return interventions
    .filter((intervention) => {
      if (query.status !== undefined && statusCode(intervention.statut ?? intervention.status) !== query.status) {
        return false;
      }
      if (query.from === undefined && query.to === undefined) return true;

      const date = interventionDate(intervention);
      if (date === undefined) return false;
      return (query.from === undefined || date >= query.from) && (query.to === undefined || date <= query.to);
    })
    .sort((a, b) => (interventionDate(b) ?? "").localeCompare(interventionDate(a) ?? "") || b.id - a.id);
}

export function interventionContractId(intervention: DolibarrIntervention): number | undefined {
  const id = numberOrUndefined(intervention.fk_contrat);
  return id !== undefined && id > 0 ? id : undefined;
}

export interface MaintenanceContractEntry {
  contract: DolibarrContract;
  endDate?: string;
  status?: ExpiryStatus;
  lastDone?: DolibarrIntervention;
  lastDoneDate?: string;
  /** Undefined when interventions cannot be read, so nothing can be concluded. */
  noMaintenanceInLookback?: boolean;
}

export interface MaintenanceOverview {
  interventionsAvailable: boolean;
  contracts: MaintenanceContractEntry[];
  inactiveContractCount: number;
  lookbackFrom: string;
}

/**
 * Per contract of a thirdparty, the latest done intervention. A contract with
 * running services and no done intervention in the last 12 months is flagged.
 * Contracts without running services are only counted, not listed.
 */
export async function loadMaintenanceOverview(thirdpartyId: number, today: string): Promise<MaintenanceOverview> {
  const [contracts, { interventions, available }] = await Promise.all([
    listAllContracts({ thirdpartyId }),
    optionalInterventions(() => listAllInterventions({ thirdpartyId })),
  ]);

  const lookbackFrom = addMonthsIso(today, -maintenanceLookbackMonths);
  const doneByContract = new Map<number, Array<{ intervention: DolibarrIntervention; date: string }>>();

  for (const intervention of interventions) {
    const contractId = interventionContractId(intervention);
    const date = interventionDate(intervention);
    if (contractId === undefined || date === undefined) continue;
    if (statusCode(intervention.statut ?? intervention.status) !== INTERVENTION_STATUS_DONE) continue;

    doneByContract.set(contractId, [...(doneByContract.get(contractId) ?? []), { intervention, date }]);
  }

  const active = contracts.filter((contract) => hasRunningServices(contract.lines));

  const entries = active.map((contract): MaintenanceContractEntry => {
    const endDate = contractEndDate(contract.lines);
    const done = doneByContract.get(Number(contract.id)) ?? [];
    const latest = done.reduce<{ intervention: DolibarrIntervention; date: string } | undefined>(
      (best, entry) => (!best || entry.date > best.date ? entry : best),
      undefined,
    );

    return {
      contract,
      endDate,
      status: endDate ? expiryStatus(endDate, today, defaultExpiryWindowDays) : undefined,
      lastDone: latest?.intervention,
      lastDoneDate: latest?.date,
      noMaintenanceInLookback: available ? !latest || latest.date < lookbackFrom : undefined,
    };
  });

  return {
    interventionsAvailable: available,
    contracts: entries.sort((a, b) => (a.endDate ?? "9999-12-31").localeCompare(b.endDate ?? "9999-12-31")),
    inactiveContractCount: contracts.length - active.length,
    lookbackFrom,
  };
}

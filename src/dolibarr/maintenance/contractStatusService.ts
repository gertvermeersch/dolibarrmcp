import { isIsoDateString, numberOrZero, unixTimestampFromIsoDate } from "../../tools/shared/normalization.js";
import { closeContract, getContract, unactivateContractLine } from "../contracts.js";
import { DolibarrApiError } from "../errors.js";
import type { DolibarrContract } from "../../types/dolibarr.js";
import type { McpError } from "../../types/tools.js";
import { LINE_STATUS_CLOSED, lineStatus, todayIso } from "./contractRules.js";

export type ContractStatusChange =
  | { status: "closed" }
  | { status: "lines_deactivated"; lineIds?: number[]; date?: string; comment?: string };

export interface ContractStatusSuccess {
  success: true;
  contract: { id: number; ref: string };
  status: string;
  /** Lines still not closed after the change; Dolibarr keeps the contract itself "validated". */
  openLineCount: number;
  closedLineIds: number[];
  skippedLineIds: number[];
  note?: string;
}

export type ContractStatusResult = ContractStatusSuccess | McpError;

export interface ContractStatusDeps {
  closeContract: typeof closeContract;
  unactivateContractLine: typeof unactivateContractLine;
  getContract: typeof getContract;
  today: () => string;
}

const defaultDeps: ContractStatusDeps = {
  closeContract,
  unactivateContractLine,
  getContract,
  today: () => todayIso(),
};

function isAlreadyClosedError(err: unknown, contractId: number): boolean {
  return err instanceof DolibarrApiError && err.status === 304 && err.path === `/contracts/${contractId}/close`;
}

function lineIdsWhere(contract: DolibarrContract, closed: boolean): number[] {
  return (contract.lines ?? [])
    .filter((line) => (lineStatus(line) === LINE_STATUS_CLOSED) === closed)
    .map((line) => Number(line.id));
}

// Closing never deletes anything: Dolibarr keeps the contract and its lines,
// and a closed service line can be activated again from the Dolibarr UI.
export class ContractStatusService {
  private readonly deps: ContractStatusDeps;

  constructor(deps: Partial<ContractStatusDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async set(contract: DolibarrContract, change: ContractStatusChange): Promise<ContractStatusResult> {
    return change.status === "closed" ? this.close(contract) : this.deactivateLines(contract, change);
  }

  private async close(contract: DolibarrContract): Promise<ContractStatusResult> {
    const contractId = Number(contract.id);

    // Dolibarr's closeAll validates a draft contract as a side effect.
    if (numberOrZero(contract.statut ?? contract.status) === 0) {
      return {
        error: "VALIDATION_ERROR",
        message: `Contract ${contract.ref} is still a draft; closing it would validate it first.`,
        action: "Validate and activate the contract in Dolibarr before closing it.",
      };
    }

    const alreadyClosed = (contract.lines ?? []).length > 0 && lineIdsWhere(contract, false).length === 0;
    let note: string | undefined;

    if (alreadyClosed) {
      note = "Already closed.";
    } else {
      try {
        await this.deps.closeContract(contractId);
      } catch (err) {
        if (!isAlreadyClosedError(err, contractId)) throw err;
        note = "Already closed.";
      }
    }

    const refreshed = await this.deps.getContract(contractId);
    return this.result(refreshed, "closed", lineIdsWhere(contract, false), [], note);
  }

  private async deactivateLines(
    contract: DolibarrContract,
    change: Extract<ContractStatusChange, { status: "lines_deactivated" }>,
  ): Promise<ContractStatusResult> {
    const date = change.date ?? this.deps.today();
    if (!isIsoDateString(date)) {
      return { error: "VALIDATION_ERROR", message: "Date must be a valid YYYY-MM-DD calendar date." };
    }

    const lines = contract.lines ?? [];
    const knownIds = new Set(lines.map((line) => Number(line.id)));
    const requested = change.lineIds ?? lineIdsWhere(contract, false);

    const unknown = requested.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      return {
        error: "VALIDATION_ERROR",
        message: `Line ID(s) ${unknown.join(", ")} do not belong to contract ${contract.ref}.`,
        action: "Use the line_id values from get_contract_detail.",
      };
    }

    const open = new Set(lineIdsWhere(contract, false));
    const toClose = [...new Set(requested)].filter((id) => open.has(id));
    const skipped = [...new Set(requested)].filter((id) => !open.has(id));

    const contractId = Number(contract.id);
    for (const lineId of toClose) {
      await this.deps.unactivateContractLine(contractId, lineId, {
        datestart: unixTimestampFromIsoDate(date),
        ...(change.comment ? { comment: change.comment } : {}),
      });
    }

    const refreshed = await this.deps.getContract(contractId);
    const note = toClose.length === 0 ? "No open lines to deactivate." : undefined;
    return this.result(refreshed, "lines_deactivated", toClose, skipped, note);
  }

  private result(
    contract: DolibarrContract,
    status: string,
    closedLineIds: number[],
    skippedLineIds: number[],
    note?: string,
  ): ContractStatusSuccess {
    return {
      success: true,
      contract: { id: Number(contract.id), ref: contract.ref },
      status,
      openLineCount: lineIdsWhere(contract, false).length,
      closedLineIds,
      skippedLineIds,
      ...(note ? { note } : {}),
    };
  }
}


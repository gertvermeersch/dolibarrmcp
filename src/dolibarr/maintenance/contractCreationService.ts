import { config } from "../../config.js";
import { resolveLine, type ResolveLineError, type ResolvedLine } from "../../resolvers/product.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import {
  isIsoDateString,
  numberOrUndefined,
  unixTimestampFromIsoDate,
} from "../../tools/shared/normalization.js";
import {
  activateContractLine,
  addContractLine,
  createContract,
  getContract,
  validateContract,
} from "../contracts.js";
import { DolibarrApiError } from "../errors.js";
import { getCurrentUser } from "../users.js";
import type { DolibarrContract, DolibarrContractLine } from "../../types/dolibarr.js";
import type { LineResolution, McpError } from "../../types/tools.js";
import { addDaysIso, addMonthsIso, LINE_STATUS_RUNNING, lineStatus } from "./contractRules.js";

export interface ContractCreationInput {
  thirdparty: string;
  startDate: string;
  months: number;
  services: Array<{ product_ref: string; qty: number }>;
}

export interface ContractCreationSuccess {
  success: true;
  id: number;
  ref?: string;
  thirdparty: string;
  startDate: string;
  endDate: string;
  months: number;
  lines: Array<LineResolution & { line_id: number; status?: number }>;
  warnings: string[];
}

export interface ContractCreationValidationError extends McpError {
  error: "VALIDATION_ERROR";
  line_errors?: ResolveLineError[];
}

// The contract exists but a later step failed. Nothing is rolled back or
// deleted; the caller gets the contract ID to finish or inspect it.
export interface ContractCreationPartialFailure extends McpError {
  contract_id: number;
  failed_step: string;
}

export type ContractCreationResult =
  | ContractCreationSuccess
  | ContractCreationValidationError
  | ContractCreationPartialFailure
  | McpError;

export interface ContractCreationDeps {
  resolveThirdparty: typeof resolveThirdparty;
  resolveLine: typeof resolveLine;
  /** Dolibarr user recorded as signing and follow-up representative. */
  commercialId: () => Promise<number | undefined>;
  createContract: typeof createContract;
  addContractLine: typeof addContractLine;
  validateContract: typeof validateContract;
  activateContractLine: typeof activateContractLine;
  getContract: typeof getContract;
}

// The configured default, else the user behind the API token. Users without
// user-read rights get a 403 from /users/info, which means "unknown" here.
async function defaultCommercialId(): Promise<number | undefined> {
  if (config.dolibarrDefaultCommercialId !== undefined) return config.dolibarrDefaultCommercialId;

  try {
    return numberOrUndefined((await getCurrentUser()).id);
  } catch (err) {
    if (err instanceof DolibarrApiError && (err.status === 403 || err.status === 404)) return undefined;
    throw err;
  }
}

const defaultDeps: ContractCreationDeps = {
  resolveThirdparty,
  resolveLine,
  commercialId: defaultCommercialId,
  createContract,
  addContractLine,
  validateContract,
  activateContractLine,
  getContract,
};

const activationComment = "Activated by create_contract";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ContractCreationService {
  private readonly deps: ContractCreationDeps;

  constructor(deps: Partial<ContractCreationDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async create(input: ContractCreationInput): Promise<ContractCreationResult> {
    if (!isIsoDateString(input.startDate)) {
      return { error: "VALIDATION_ERROR", message: "Start date must be a valid YYYY-MM-DD calendar date." };
    }

    const resolvedThirdparty = await this.deps.resolveThirdparty(input.thirdparty);
    if (!resolvedThirdparty.ok) return resolvedThirdparty.error;

    // Resolve every catalog ref before the first write.
    const lineResults = await Promise.all(
      input.services.map((service, index) =>
        this.deps.resolveLine({ product_ref: service.product_ref, qty: service.qty }, index + 1),
      ),
    );
    const lineErrors = lineResults.flatMap((result) => (result.ok ? [] : [result.error]));
    if (lineErrors.length > 0) {
      return {
        error: "VALIDATION_ERROR",
        message: "One or more services could not be resolved.",
        line_errors: lineErrors,
      };
    }
    const resolvedLines = lineResults.flatMap((result) => (result.ok ? [result.resolved] : []));

    const commercialId = await this.deps.commercialId();
    if (commercialId === undefined) {
      return {
        error: "VALIDATION_ERROR",
        message: "Dolibarr requires a signing and follow-up representative on a contract, and the API user could not be determined.",
        action: "Set DOLIBARR_DEFAULT_COMMERCIAL_ID to a Dolibarr user ID, or give the API user read access to users.",
      };
    }

    const startDate = input.startDate;
    const endDate = addDaysIso(addMonthsIso(startDate, input.months), -1);
    const start = unixTimestampFromIsoDate(startDate);
    const end = unixTimestampFromIsoDate(endDate);

    let contractId: number | undefined;
    let step = "create contract";

    try {
      contractId = await this.deps.createContract({
        socid: resolvedThirdparty.id,
        date_contrat: start,
        commercial_signature_id: commercialId,
        commercial_suivi_id: commercialId,
      });

      step = "add lines";
      const lineIds: number[] = [];
      for (const resolved of resolvedLines) {
        lineIds.push(await this.addLine(contractId, resolved, start, end));
      }

      step = "validate contract";
      await this.deps.validateContract(contractId);

      step = "activate lines";
      for (const lineId of lineIds) {
        await this.deps.activateContractLine(contractId, lineId, {
          datestart: start,
          dateend: end,
          comment: activationComment,
        });
      }

      step = "read back contract";
      const contract = await this.deps.getContract(contractId);
      return this.success(input, resolvedThirdparty.name, contract, resolvedLines, lineIds, endDate);
    } catch (err) {
      if (contractId === undefined) throw err;

      return {
        error: "DOLIBARR_API_ERROR",
        message: `Contract ${contractId} was created, but the step '${step}' failed: ${describeError(err)}. Nothing was deleted; inspect the contract with get_contract_detail.`,
        action: "Fix the cause and finish the contract in Dolibarr, or ask for its status with get_contract_detail.",
        contract_id: contractId,
        failed_step: step,
      } satisfies ContractCreationPartialFailure;
    }
  }

  private async addLine(contractId: number, resolved: ResolvedLine, start: number, end: number): Promise<number> {
    const { line, resolution } = resolved;
    const lineId = await this.deps.addContractLine(contractId, {
      desc: line.desc ?? resolution.label,
      qty: line.qty,
      subprice: line.subprice,
      tva_tx: line.tva_tx,
      fk_product: line.fk_product,
      date_start: start,
      date_end: end,
    });

    const id = numberOrUndefined(lineId);
    if (id === undefined || id <= 0) {
      throw new Error(`Dolibarr did not add the line for '${resolution.label}'.`);
    }
    return id;
  }

  private success(
    input: ContractCreationInput,
    thirdpartyName: string,
    contract: DolibarrContract,
    resolvedLines: ResolvedLine[],
    lineIds: number[],
    endDate: string,
  ): ContractCreationSuccess {
    const byId = new Map<number, DolibarrContractLine>(
      (contract.lines ?? []).map((line) => [Number(line.id), line]),
    );
    const warnings: string[] = [];

    const lines = resolvedLines.map((resolved, index) => {
      const lineId = lineIds[index];
      const status = byId.has(lineId) ? lineStatus(byId.get(lineId)!) : undefined;
      if (status !== LINE_STATUS_RUNNING) {
        warnings.push(`Line ${lineId} (${resolved.resolution.label}) is not running after activation.`);
      }
      return { ...resolved.resolution, line_id: lineId, status };
    });

    return {
      success: true,
      id: Number(contract.id),
      ref: contract.ref,
      thirdparty: thirdpartyName,
      startDate: input.startDate,
      endDate,
      months: input.months,
      lines,
      warnings,
    };
  }
}

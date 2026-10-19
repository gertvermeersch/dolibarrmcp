import { isIsoDateString, unixTimestampFromIsoDate } from "../../tools/shared/normalization.js";
import {
  addInterventionLine,
  closeIntervention,
  createIntervention,
  getIntervention,
  validateIntervention,
} from "../interventions.js";
import type { DolibarrContract, DolibarrIntervention } from "../../types/dolibarr.js";
import type { McpError } from "../../types/tools.js";

export interface InterventionCreationInput {
  contract: DolibarrContract;
  date: string;
  durationHours: number;
  description: string;
  /** Mark the intervention as done after validating it. */
  close: boolean;
}

export interface InterventionCreationSuccess {
  success: true;
  intervention: DolibarrIntervention;
  contract: { id: number; ref: string };
  date: string;
  durationHours: number;
  closed: boolean;
}

// The intervention exists but a later step failed. Nothing is deleted.
export interface InterventionPartialFailure extends McpError {
  intervention_id: number;
  failed_step: string;
}

export type InterventionCreationResult =
  | InterventionCreationSuccess
  | InterventionPartialFailure
  | McpError;

export interface InterventionCreationDeps {
  createIntervention: typeof createIntervention;
  addInterventionLine: typeof addInterventionLine;
  validateIntervention: typeof validateIntervention;
  closeIntervention: typeof closeIntervention;
  getIntervention: typeof getIntervention;
}

const defaultDeps: InterventionCreationDeps = {
  createIntervention,
  addInterventionLine,
  validateIntervention,
  closeIntervention,
  getIntervention,
};

export class InterventionCreationService {
  private readonly deps: InterventionCreationDeps;

  constructor(deps: Partial<InterventionCreationDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async create(input: InterventionCreationInput): Promise<InterventionCreationResult> {
    if (!isIsoDateString(input.date)) {
      return { error: "VALIDATION_ERROR", message: "Date must be a valid YYYY-MM-DD calendar date." };
    }

    const seconds = Math.round(input.durationHours * 3600);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return { error: "VALIDATION_ERROR", message: "Duration must be a positive number of hours." };
    }

    const contractId = Number(input.contract.id);
    let interventionId: number | undefined;
    let step = "create intervention";

    try {
      // fk_project is mandatory; 0 means no project.
      interventionId = await this.deps.createIntervention({
        socid: Number(input.contract.socid),
        fk_project: 0,
        description: input.description,
        fk_contrat: contractId,
      });

      step = "add line";
      await this.deps.addInterventionLine(interventionId, {
        description: input.description,
        date: unixTimestampFromIsoDate(input.date),
        duration: seconds,
      });

      step = "validate intervention";
      await this.deps.validateIntervention(interventionId);

      if (input.close) {
        step = "close intervention";
        await this.deps.closeIntervention(interventionId);
      }

      step = "read back intervention";
      const intervention = await this.deps.getIntervention(interventionId);

      return {
        success: true,
        intervention,
        contract: { id: contractId, ref: input.contract.ref },
        date: input.date,
        durationHours: input.durationHours,
        closed: input.close,
      };
    } catch (err) {
      if (interventionId === undefined) throw err;

      return {
        error: "DOLIBARR_API_ERROR",
        message: `Intervention ${interventionId} was created, but the step '${step}' failed: ${err instanceof Error ? err.message : String(err)}. Nothing was deleted; inspect it with list_interventions.`,
        action: "Complete the intervention in Dolibarr, then retry only the missing steps.",
        intervention_id: interventionId,
        failed_step: step,
      } satisfies InterventionPartialFailure;
    }
  }
}

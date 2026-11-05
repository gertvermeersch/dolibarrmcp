import { config } from "../../config.js";
import { DolibarrApiError } from "../errors.js";
import {
  addProjectUserContact,
  addTimeSpent,
  createProject,
  createTask,
  getProject,
  getTask,
  updateProject,
  updateTask,
  validateProject,
} from "../projects.js";
import { getCurrentUser } from "../users.js";
import {
  dolibarrTimeZone,
  isIsoDateString,
  isoDateFromTimestamp,
  numberOrUndefined,
  unixTimestampFromIsoDate,
} from "../../tools/shared/normalization.js";
import { todayIso } from "../maintenance/contractRules.js";
import {
  gmtDateTimeFromLocal,
  hoursFromSeconds,
  isTimeOfDay,
  leadStageByName,
  PROJECT_STATUS_CLOSED,
  PROJECT_STATUS_DRAFT,
  PROJECT_STATUS_OPEN,
  projectStatus,
  secondsFromHours,
  type LeadStageName,
  type ProjectStatusName,
} from "./projectRules.js";
import type { DolibarrProject, DolibarrTask } from "../../types/dolibarr.js";
import type { McpError } from "../../types/tools.js";

// Write flows for projects, tasks and time. When a step after the first write
// fails they return an error with the ID of the record already created; they
// never roll back by deleting.

export const DEFAULT_TIME_START = "09:00";
const maxHoursPerEntry = 24;

export interface LeadInput {
  stage?: LeadStageName;
  amount?: number;
  /** Percent; defaults to the stage's probability. */
  probability?: number;
}

export interface ProjectCreationInput {
  thirdpartyId: number;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  usesTasks: boolean;
  billsTime: boolean;
  visibleToEveryone: boolean;
  lead?: LeadInput;
  /** Validate the project so it is open; false leaves it as a draft. */
  open: boolean;
}

export interface ProjectChanges {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  usesTasks?: boolean;
  billsTime?: boolean;
  visibleToEveryone?: boolean;
  isLead?: boolean;
  leadStage?: LeadStageName;
  leadAmount?: number;
  leadProbability?: number;
}

export interface TaskCreationInput {
  label: string;
  description?: string;
  plannedHours?: number;
  startDate?: string;
  endDate?: string;
  parentTaskId?: number;
  billable?: boolean;
}

export interface TaskChanges {
  label?: string;
  description?: string;
  plannedHours?: number;
  startDate?: string;
  endDate?: string;
  progress?: number;
}

export interface TimeEntryInput {
  date: string;
  hours: number;
  /** Local start time HH:MM in DOLIBARR_TIMEZONE. */
  startTime?: string;
  note?: string;
  /** Dolibarr user the time is for; the API user when omitted. */
  userId?: number;
  /** New task progress in percent. */
  progress?: number;
}

export interface PartialFailure extends McpError {
  failed_step: string;
  project_id?: number;
  task_id?: number;
}

export type WriteResult<T> = ({ success: true } & T) | McpError | PartialFailure;

export interface ProjectWriteDeps {
  createProject: typeof createProject;
  updateProject: typeof updateProject;
  validateProject: typeof validateProject;
  getProject: typeof getProject;
  addProjectUserContact: typeof addProjectUserContact;
  createTask: typeof createTask;
  updateTask: typeof updateTask;
  getTask: typeof getTask;
  addTimeSpent: typeof addTimeSpent;
  /** The Dolibarr user made project leader on new projects. */
  currentUserId: () => Promise<number | undefined>;
  today: () => string;
  timeZone: () => string;
}

// The API user, as the Dolibarr UI makes the creating user project leader.
// A user without user read rights gets a 403; fall back to the configured
// default representative.
async function defaultCurrentUserId(): Promise<number | undefined> {
  try {
    return numberOrUndefined((await getCurrentUser()).id);
  } catch (err) {
    if (err instanceof DolibarrApiError && err.status === 403) return config.dolibarrDefaultCommercialId;
    throw err;
  }
}

const defaultDeps: ProjectWriteDeps = {
  createProject,
  updateProject,
  validateProject,
  getProject,
  addProjectUserContact,
  createTask,
  updateTask,
  getTask,
  addTimeSpent,
  currentUserId: defaultCurrentUserId,
  today: () => todayIso(),
  timeZone: dolibarrTimeZone,
};

function validationError(message: string): McpError {
  return { error: "VALIDATION_ERROR", message };
}

function invalidDate(fields: Record<string, string | undefined>): McpError | undefined {
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && !isIsoDateString(value)) {
      return validationError(`${name} must be a valid YYYY-MM-DD calendar date.`);
    }
  }
  return undefined;
}

function invalidRange(start: string | undefined, end: string | undefined): McpError | undefined {
  if (start && end && end < start) return validationError("end_date must be on or after start_date.");
  return undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Opportunity fields for a lead: stage ID, probability (stage default when not
// given) and amount.
function leadFields(lead: { stage?: LeadStageName; amount?: number; probability?: number }): Record<string, number> {
  const stage = lead.stage ? leadStageByName(lead.stage) : undefined;
  return {
    usage_opportunity: 1,
    ...(stage ? { opp_status: stage.id } : {}),
    ...(lead.probability !== undefined
      ? { opp_percent: lead.probability }
      : stage ? { opp_percent: stage.percent } : {}),
    ...(lead.amount !== undefined ? { opp_amount: lead.amount } : {}),
  };
}

export class ProjectWriteService {
  private readonly deps: ProjectWriteDeps;

  constructor(deps: Partial<ProjectWriteDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async createProject(input: ProjectCreationInput): Promise<WriteResult<{ project: DolibarrProject; warnings: string[] }>> {
    const startDate = input.startDate ?? this.deps.today();
    const invalid = invalidDate({ start_date: startDate, end_date: input.endDate })
      ?? invalidRange(startDate, input.endDate);
    if (invalid) return invalid;

    const lead = input.lead ? leadFields({ stage: "prospection", ...input.lead }) : {};

    const projectId = await this.deps.createProject({
      ref: "auto",
      title: input.title,
      socid: input.thirdpartyId,
      ...(input.description ? { description: input.description } : {}),
      date_start: unixTimestampFromIsoDate(startDate),
      ...(input.endDate ? { date_end: unixTimestampFromIsoDate(input.endDate) } : {}),
      ...(input.budget !== undefined ? { budget_amount: input.budget } : {}),
      public: input.visibleToEveryone ? 1 : 0,
      usage_task: input.usesTasks ? 1 : 0,
      usage_bill_time: input.billsTime ? 1 : 0,
      ...lead,
    });

    const warnings: string[] = [];
    const hiddenHint = "A project visible to assigned contacts only may be hidden from users without the right to see all projects.";

    // The Dolibarr UI makes the creating user project leader; the API does not.
    // A failure here leaves a usable project, so it is a warning.
    try {
      const leaderId = await this.deps.currentUserId();
      if (leaderId === undefined) {
        warnings.push(`No project leader was assigned: the API user could not be read and DOLIBARR_DEFAULT_COMMERCIAL_ID is not set. ${hiddenHint}`);
      } else {
        await this.deps.addProjectUserContact(projectId, leaderId, "PROJECTLEADER");
      }
    } catch (err) {
      warnings.push(`Assigning the project leader failed: ${errorText(err)}. ${hiddenHint}`);
    }

    let step = "validate project";
    try {
      if (input.open) {
        step = "validate project";
        await this.deps.validateProject(projectId);
      }

      step = "read back project";
      const project = await this.deps.getProject(projectId);
      return { success: true, project, warnings };
    } catch (err) {
      return {
        error: "DOLIBARR_API_ERROR",
        message: `Project ${projectId} was created, but the step '${step}' failed: ${errorText(err)}. Nothing was deleted; inspect it with get_project_detail.`,
        action: "Complete the project in Dolibarr, then retry only the missing step.",
        project_id: projectId,
        failed_step: step,
      } satisfies PartialFailure;
    }
  }

  async updateProject(
    project: DolibarrProject,
    changes: ProjectChanges,
  ): Promise<WriteResult<{ project: DolibarrProject; changed: string[] }>> {
    const invalid = invalidDate({ start_date: changes.startDate, end_date: changes.endDate })
      ?? invalidRange(
        changes.startDate ?? isoDateFromTimestamp(project.date_start),
        changes.endDate ?? isoDateFromTimestamp(project.date_end),
      );
    if (invalid) return invalid;

    if (changes.isLead === false && (changes.leadStage || changes.leadAmount !== undefined || changes.leadProbability !== undefined)) {
      return validationError("is_lead false cannot be combined with lead_stage, lead_amount or lead_probability.");
    }

    const fields: Record<string, unknown> = {
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.startDate ? { date_start: unixTimestampFromIsoDate(changes.startDate) } : {}),
      ...(changes.endDate ? { date_end: unixTimestampFromIsoDate(changes.endDate) } : {}),
      ...(changes.budget !== undefined ? { budget_amount: changes.budget } : {}),
      ...(changes.usesTasks !== undefined ? { usage_task: changes.usesTasks ? 1 : 0 } : {}),
      ...(changes.billsTime !== undefined ? { usage_bill_time: changes.billsTime ? 1 : 0 } : {}),
      ...(changes.visibleToEveryone !== undefined ? { public: changes.visibleToEveryone ? 1 : 0 } : {}),
      ...(changes.isLead === false ? { usage_opportunity: 0 } : {}),
      ...(changes.isLead || changes.leadStage || changes.leadAmount !== undefined || changes.leadProbability !== undefined
        ? leadFields({ stage: changes.leadStage, amount: changes.leadAmount, probability: changes.leadProbability })
        : {}),
    };

    const changed = Object.keys(fields);
    if (changed.length === 0) return validationError("Nothing to update: pass at least one field to change.");

    const projectId = Number(project.id);
    await this.deps.updateProject(projectId, fields);
    return { success: true, project: await this.deps.getProject(projectId), changed };
  }

  async setStatus(
    project: DolibarrProject,
    target: Exclude<ProjectStatusName, "draft">,
  ): Promise<WriteResult<{ project: DolibarrProject; previous_status: number | undefined; steps: string[] }>> {
    const projectId = Number(project.id);
    const current = projectStatus(project);
    const steps: string[] = [];

    if (target === "open" && current !== PROJECT_STATUS_OPEN) {
      // setValid opens a draft and reopens a closed project alike.
      await this.deps.validateProject(projectId);
      steps.push(current === PROJECT_STATUS_CLOSED ? "reopened" : "validated");
    }

    if (target === "closed" && current !== PROJECT_STATUS_CLOSED) {
      let step = "validate project";
      try {
        if (current === PROJECT_STATUS_DRAFT) {
          await this.deps.validateProject(projectId);
          steps.push("validated");
        }

        // Dolibarr has no close endpoint; set the status like Project::setClose.
        step = "close project";
        const closedBy = await this.deps.currentUserId().catch(() => undefined);
        await this.deps.updateProject(projectId, {
          status: PROJECT_STATUS_CLOSED,
          date_close: Math.floor(Date.now() / 1000),
          ...(closedBy !== undefined ? { fk_user_close: closedBy } : {}),
        });
        steps.push("closed");
      } catch (err) {
        if (steps.length === 0) throw err;
        return {
          error: "DOLIBARR_API_ERROR",
          message: `Project ${project.ref} was validated, but the step '${step}' failed: ${errorText(err)}.`,
          project_id: projectId,
          failed_step: step,
        } satisfies PartialFailure;
      }
    }

    return {
      success: true,
      project: steps.length > 0 ? await this.deps.getProject(projectId) : project,
      previous_status: current,
      steps,
    };
  }

  async createTask(
    project: DolibarrProject,
    input: TaskCreationInput,
  ): Promise<WriteResult<{ task: DolibarrTask; warnings: string[] }>> {
    const invalid = invalidDate({ start_date: input.startDate, end_date: input.endDate })
      ?? invalidRange(input.startDate, input.endDate);
    if (invalid) return invalid;

    const projectId = Number(project.id);
    const taskId = await this.deps.createTask({
      ref: "auto",
      label: input.label,
      fk_project: projectId,
      ...(input.description ? { description: input.description } : {}),
      ...(input.parentTaskId !== undefined ? { fk_task_parent: input.parentTaskId } : {}),
      ...(input.startDate ? { date_start: unixTimestampFromIsoDate(input.startDate) } : {}),
      ...(input.endDate ? { date_end: unixTimestampFromIsoDate(input.endDate) } : {}),
      ...(input.plannedHours !== undefined ? { planned_workload: secondsFromHours(input.plannedHours) } : {}),
      // Like the Dolibarr UI, a task is billable when the project bills time.
      billable: (input.billable ?? numberOrUndefined(project.usage_bill_time) === 1) ? 1 : 0,
    });

    const warnings: string[] = [];
    if (numberOrUndefined(project.usage_task) !== 1) {
      warnings.push(`Tasks are not enabled on project ${project.ref}, so Dolibarr hides its Tasks tab. Run update_project with uses_tasks: true to show it.`);
    }
    if (projectStatus(project) === PROJECT_STATUS_CLOSED) {
      warnings.push(`Project ${project.ref} is closed.`);
    }

    try {
      return { success: true, task: await this.deps.getTask(taskId), warnings };
    } catch (err) {
      return {
        error: "DOLIBARR_API_ERROR",
        message: `Task ${taskId} was created, but reading it back failed: ${errorText(err)}.`,
        task_id: taskId,
        project_id: projectId,
        failed_step: "read back task",
      } satisfies PartialFailure;
    }
  }

  async updateTask(
    task: DolibarrTask,
    changes: TaskChanges,
  ): Promise<WriteResult<{ task: DolibarrTask; changed: string[] }>> {
    const invalid = invalidDate({ start_date: changes.startDate, end_date: changes.endDate })
      ?? invalidRange(
        changes.startDate ?? isoDateFromTimestamp(task.date_start),
        changes.endDate ?? isoDateFromTimestamp(task.date_end),
      );
    if (invalid) return invalid;

    const fields: Record<string, unknown> = {
      ...(changes.label !== undefined ? { label: changes.label } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.plannedHours !== undefined ? { planned_workload: secondsFromHours(changes.plannedHours) } : {}),
      ...(changes.startDate ? { date_start: unixTimestampFromIsoDate(changes.startDate) } : {}),
      ...(changes.endDate ? { date_end: unixTimestampFromIsoDate(changes.endDate) } : {}),
      ...(changes.progress !== undefined ? { progress: changes.progress } : {}),
    };

    const changed = Object.keys(fields);
    if (changed.length === 0) return validationError("Nothing to update: pass at least one field to change.");

    const taskId = Number(task.id);
    await this.deps.updateTask(taskId, fields);
    return { success: true, task: await this.deps.getTask(taskId), changed };
  }

  async logTime(
    task: DolibarrTask,
    input: TimeEntryInput,
  ): Promise<WriteResult<{ task: DolibarrTask; entry: Record<string, unknown>; spent_hours_before: number }>> {
    const invalid = invalidDate({ date: input.date });
    if (invalid) return invalid;

    const startTime = input.startTime ?? DEFAULT_TIME_START;
    if (!isTimeOfDay(startTime)) return validationError("start_time must be HH:MM, for example 09:30.");

    if (!(input.hours > 0) || input.hours > maxHoursPerEntry) {
      return validationError(`hours must be more than 0 and at most ${maxHoursPerEntry}.`);
    }

    const duration = secondsFromHours(input.hours);
    const taskId = Number(task.id);

    await this.deps.addTimeSpent(taskId, {
      date: gmtDateTimeFromLocal(input.date, startTime, this.deps.timeZone()),
      duration,
      user_id: input.userId ?? 0,
      ...(input.note ? { note: input.note } : {}),
      ...(input.progress !== undefined ? { progress: input.progress } : {}),
    });

    const entry = {
      date: input.date,
      start_time: startTime,
      hours: hoursFromSeconds(duration),
      ...(input.note ? { note: input.note } : {}),
      ...(input.userId !== undefined ? { user_id: input.userId } : {}),
    };

    try {
      return {
        success: true,
        task: await this.deps.getTask(taskId),
        entry,
        spent_hours_before: hoursFromSeconds(task.duration_effective),
      };
    } catch (err) {
      return {
        error: "DOLIBARR_API_ERROR",
        message: `The time was logged on task ${task.ref}, but reading the task back failed: ${errorText(err)}. Do not log it again.`,
        task_id: taskId,
        failed_step: "read back task",
      } satisfies PartialFailure;
    }
  }
}

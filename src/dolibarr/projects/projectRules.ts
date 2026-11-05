import { isoDateFromTimestamp, money, numberOrUndefined } from "../../tools/shared/normalization.js";
import type { DolibarrProject, DolibarrTask } from "../../types/dolibarr.js";

// Pure derivations for projects, leads, tasks and time. No I/O; "today" is
// passed in where it matters.

// Project statuses (Project::STATUS_*).
export const PROJECT_STATUS_DRAFT = 0;
export const PROJECT_STATUS_OPEN = 1;
export const PROJECT_STATUS_CLOSED = 2;

export type ProjectStatusName = "draft" | "open" | "closed";

export const projectStatusCodes: Record<ProjectStatusName, number> = {
  draft: PROJECT_STATUS_DRAFT,
  open: PROJECT_STATUS_OPEN,
  closed: PROJECT_STATUS_CLOSED,
};

const projectStatusNames: Record<number, ProjectStatusName> = {
  [PROJECT_STATUS_DRAFT]: "draft",
  [PROJECT_STATUS_OPEN]: "open",
  [PROJECT_STATUS_CLOSED]: "closed",
};

// Dolibarr sends unset amounts as null or ""; Number() would turn those into 0.
export function optionalMoney(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return money(value);
}

export function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return numberOrUndefined(value);
}

export function projectStatus(project: DolibarrProject): number | undefined {
  return numberOrUndefined(project.status ?? project.statut);
}

export function projectStatusLabel(project: DolibarrProject): string | undefined {
  const status = projectStatus(project);
  if (status === undefined) return undefined;
  return projectStatusNames[status] ?? String(status);
}

// Lead stages: the default llx_c_lead_status dictionary. Dolibarr exposes no
// REST endpoint for it, so the IDs are fixed here. PENDING ships inactive.
export const leadStageNames = [
  "prospection",
  "qualification",
  "proposal",
  "negotiation",
  "pending",
  "won",
  "lost",
] as const;

export type LeadStageName = (typeof leadStageNames)[number];

export interface LeadStage {
  id: number;
  code: string;
  name: LeadStageName;
  /** Default probability (percent) Dolibarr suggests for the stage. */
  percent: number;
}

export const leadStages: LeadStage[] = [
  { id: 1, code: "PROSP", name: "prospection", percent: 0 },
  { id: 2, code: "QUAL", name: "qualification", percent: 20 },
  { id: 3, code: "PROPO", name: "proposal", percent: 40 },
  { id: 4, code: "NEGO", name: "negotiation", percent: 60 },
  { id: 5, code: "PENDING", name: "pending", percent: 50 },
  { id: 6, code: "WON", name: "won", percent: 100 },
  { id: 7, code: "LOST", name: "lost", percent: 0 },
];

export function leadStageById(id: unknown): LeadStage | undefined {
  const numeric = numberOrUndefined(id);
  return leadStages.find((stage) => stage.id === numeric);
}

export function leadStageByName(name: LeadStageName): LeadStage {
  return leadStages.find((stage) => stage.name === name)!;
}

// A won or lost lead is decided; every other stage is still in the pipeline.
export function isDecidedStage(stage: LeadStage | undefined): boolean {
  return stage?.name === "won" || stage?.name === "lost";
}

export function isLead(project: DolibarrProject): boolean {
  return numberOrUndefined(project.usage_opportunity) === 1 || (numberOrUndefined(project.opp_status) ?? 0) > 0;
}

// In the pipeline: a lead that is not closed and not won or lost.
export function isOpenLead(project: DolibarrProject): boolean {
  return isLead(project)
    && projectStatus(project) !== PROJECT_STATUS_CLOSED
    && !isDecidedStage(leadStageById(project.opp_status));
}

export function weightedAmount(amount: number | undefined, percent: number | undefined): number | undefined {
  if (amount === undefined) return undefined;
  return money(amount * (percent ?? 0) / 100);
}

export interface LeadSummary {
  stage?: LeadStageName | string;
  amount?: number;
  probability?: number;
  weighted_amount?: number;
}

export function leadSummary(project: DolibarrProject): LeadSummary | undefined {
  if (!isLead(project)) return undefined;

  const stageId = numberOrUndefined(project.opp_status);
  const stage = leadStageById(stageId);
  const amount = optionalMoney(project.opp_amount);
  const probability = optionalNumber(project.opp_percent);

  return {
    stage: stage?.name ?? (stageId ? `stage_${stageId}` : undefined),
    amount,
    probability,
    weighted_amount: weightedAmount(amount, probability),
  };
}

export function hoursFromSeconds(seconds: unknown): number {
  const value = numberOrUndefined(seconds) ?? 0;
  return Math.round((value / 3600) * 100) / 100;
}

export function secondsFromHours(hours: number): number {
  return Math.round(hours * 3600);
}

export function taskProgress(task: DolibarrTask): number | undefined {
  return numberOrUndefined(task.progress);
}

// Planned vs. spent for one task; spent comes from duration_effective, which
// Dolibarr keeps up to date as time is logged.
export function taskHours(task: DolibarrTask): { planned?: number; spent: number; remaining?: number } {
  const plannedSeconds = numberOrUndefined(task.planned_workload);
  const planned = plannedSeconds ? hoursFromSeconds(plannedSeconds) : undefined;
  const spent = hoursFromSeconds(task.duration_effective);
  return {
    planned,
    spent,
    remaining: planned !== undefined ? Math.round((planned - spent) * 100) / 100 : undefined,
  };
}

// Date part of a database datetime string such as "2026-11-05 09:00:00".
export function isoDateFromDbDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1];
}

export function isTimeOfDay(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

// Offset of `timeZone` from UTC at `utcMs`, in milliseconds.
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return asUtc - utcMs;
}

/**
 * Convert a local date and time in `timeZone` to the "YYYY-MM-DD HH:MM:SS" GMT
 * string that POST /tasks/{id}/addtimespent expects.
 */
export function gmtDateTimeFromLocal(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // Two passes settle the offset across a DST change.
  let utcMs = wallClockAsUtc - timeZoneOffsetMs(wallClockAsUtc, timeZone);
  utcMs = wallClockAsUtc - timeZoneOffsetMs(utcMs, timeZone);

  return new Date(utcMs).toISOString().slice(0, 19).replace("T", " ");
}

export function projectDates(project: DolibarrProject): { start_date?: string; end_date?: string; closed_on?: string } {
  return {
    start_date: isoDateFromTimestamp(project.date_start),
    end_date: isoDateFromTimestamp(project.date_end),
    // Reopening keeps date_close in Dolibarr; it only means something while closed.
    closed_on: projectStatus(project) === PROJECT_STATUS_CLOSED ? isoDateFromTimestamp(project.date_close) : undefined,
  };
}

export interface PipelineStageTotals {
  stage: string;
  count: number;
  amount: number;
  weighted_amount: number;
}

export interface PipelineSummary {
  open_leads: number;
  total_amount: number;
  weighted_amount: number;
  by_stage: PipelineStageTotals[];
  /** Open leads whose end date (expected close) has passed. */
  overdue: DolibarrProject[];
  /** Open leads without an amount; they count as zero in the totals. */
  without_amount: DolibarrProject[];
}

// Totals over the open leads in `projects`, by stage in pipeline order.
export function pipelineSummary(projects: DolibarrProject[], today: string): PipelineSummary {
  const open = projects.filter(isOpenLead);
  const byStage = new Map<string, PipelineStageTotals>();

  for (const project of open) {
    const lead = leadSummary(project)!;
    const stage = lead.stage ?? "no_stage";
    const totals = byStage.get(stage) ?? { stage, count: 0, amount: 0, weighted_amount: 0 };
    totals.count++;
    totals.amount = money(totals.amount + (lead.amount ?? 0)) ?? 0;
    totals.weighted_amount = money(totals.weighted_amount + (lead.weighted_amount ?? 0)) ?? 0;
    byStage.set(stage, totals);
  }

  const order = (stage: string) => {
    const index = leadStageNames.indexOf(stage as LeadStageName);
    return index === -1 ? leadStageNames.length : index;
  };

  const by_stage = [...byStage.values()].sort((a, b) => order(a.stage) - order(b.stage));

  return {
    open_leads: open.length,
    total_amount: money(by_stage.reduce((sum, stage) => sum + stage.amount, 0)) ?? 0,
    weighted_amount: money(by_stage.reduce((sum, stage) => sum + stage.weighted_amount, 0)) ?? 0,
    by_stage,
    overdue: open.filter((project) => {
      const end = isoDateFromTimestamp(project.date_end);
      return end !== undefined && end < today;
    }),
    without_amount: open.filter((project) => optionalMoney(project.opp_amount) === undefined),
  };
}

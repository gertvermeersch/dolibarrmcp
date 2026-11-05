import {
  hoursFromSeconds,
  isoDateFromDbDateTime,
  leadSummary,
  optionalMoney,
  projectDates,
  projectStatusLabel,
  taskHours,
  taskProgress,
} from "../../dolibarr/projects/projectRules.js";
import { cleanString, compactObject, isoDateFromTimestamp, numberOrUndefined } from "./normalization.js";
import type { DolibarrProject, DolibarrTask, DolibarrTimeSpentRow } from "../../types/dolibarr.js";

function flag(value: unknown): boolean {
  return numberOrUndefined(value) === 1;
}

export function serializeProjectSummary(
  project: DolibarrProject,
  clientNames: Map<number, string> = new Map(),
): Record<string, unknown> {
  const thirdpartyId = numberOrUndefined(project.socid);

  return compactObject({
    id: numberOrUndefined(project.id),
    ref: cleanString(project.ref),
    title: cleanString(project.title),
    thirdparty_id: thirdpartyId && thirdpartyId > 0 ? thirdpartyId : undefined,
    client_name: thirdpartyId ? clientNames.get(thirdpartyId) : undefined,
    status: projectStatusLabel(project),
    ...projectDates(project),
    budget: optionalMoney(project.budget_amount),
    uses_tasks: flag(project.usage_task),
    bills_time: flag(project.usage_bill_time),
    lead: leadSummary(project),
  });
}

export function serializeProjectDetail(
  project: DolibarrProject,
  clientNames: Map<number, string> = new Map(),
): Record<string, unknown> {
  return compactObject({
    ...serializeProjectSummary(project, clientNames),
    description: cleanString(project.description),
    visibility: flag(project.public) ? "everyone" : "assigned_contacts",
    note_public: cleanString(project.note_public),
    note_private: cleanString(project.note_private),
  });
}

export function serializeTask(task: DolibarrTask): Record<string, unknown> {
  const hours = taskHours(task);
  const parentId = numberOrUndefined(task.fk_task_parent);

  return compactObject({
    id: numberOrUndefined(task.id),
    ref: cleanString(task.ref),
    label: cleanString(task.label),
    description: cleanString(task.description),
    project_id: numberOrUndefined(task.fk_project),
    parent_task_id: parentId && parentId > 0 ? parentId : undefined,
    start_date: isoDateFromTimestamp(task.date_start),
    end_date: isoDateFromTimestamp(task.date_end),
    planned_hours: hours.planned,
    spent_hours: hours.spent,
    remaining_hours: hours.remaining,
    progress: taskProgress(task),
    billable: flag(task.billable),
  });
}

export function timeEntryUserName(row: DolibarrTimeSpentRow): string | undefined {
  const fullName = cleanString([row.user_firstname, row.user_lastname].filter(Boolean).join(" "));
  return fullName ?? cleanString(row.user_login);
}

export function serializeTimeEntry(row: DolibarrTimeSpentRow): Record<string, unknown> {
  return compactObject({
    id: numberOrUndefined(row.rowid),
    date: isoDateFromDbDateTime(row.element_datehour),
    hours: hoursFromSeconds(row.element_duration),
    note: cleanString(row.time_note),
    user: timeEntryUserName(row),
    user_id: numberOrUndefined(row.fk_user),
    project_id: numberOrUndefined(row.project_id),
    project_ref: cleanString(row.project_ref),
    project_title: cleanString(row.project_title),
    task_id: numberOrUndefined(row.task_id),
    task_ref: cleanString(row.task_ref),
    task_label: cleanString(row.task_label),
    client_name: cleanString(row.soc_name),
  });
}

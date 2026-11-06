import { dolibarr, type DolibarrRequestOptions } from "./client.js";
import { isDolibarrNotFoundError } from "./errors.js";
import { listAllPages } from "./pagination.js";
import { dolibarrQueryString } from "./sqlFilters.js";
import type { DolibarrProject, DolibarrTask, DolibarrTimeSpentEntry, DolibarrTimeSpentRow } from "../types/dolibarr.js";

// Projects and tasks. A lead is a project with the opportunity fields set; see
// dolibarr/projects/projectRules.ts for the stage dictionary.

export async function getProject(id: number): Promise<DolibarrProject> {
  return dolibarr.get<DolibarrProject>(`/projects/${id}`);
}

export async function listProjects(params: string): Promise<DolibarrProject[]> {
  try {
    return await dolibarr.get<DolibarrProject[]>(`/projects?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

// Every project matching `sqlfilters`, optionally for one thirdparty.
export async function listAllProjects(
  options: { thirdpartyId?: number; sqlfilters?: string } = {},
): Promise<DolibarrProject[]> {
  return listAllPages((page, pageSize) =>
    listProjects(dolibarrQueryString({
      sortfield: "t.rowid",
      sortorder: "DESC",
      limit: String(pageSize),
      page: String(page),
      ...(options.thirdpartyId !== undefined ? { thirdparty_ids: String(options.thirdpartyId) } : {}),
      ...(options.sqlfilters ? { sqlfilters: options.sqlfilters } : {}),
    })),
  );
}

// Dolibarr requires ref and title; ref "auto" takes the next number from the
// numbering module. The lead stage is written from `opp_status`.
export async function createProject(data: {
  ref: "auto";
  title: string;
  socid: number;
  description?: string;
  date_start?: number;
  date_end?: number;
  budget_amount?: number;
  public?: 0 | 1;
  usage_task?: 0 | 1;
  usage_bill_time?: 0 | 1;
  usage_opportunity?: 0 | 1;
  opp_status?: number;
  opp_amount?: number;
  opp_percent?: number;
}): Promise<number> {
  return dolibarr.post<number>("/projects", data);
}

// PUT fetches the project and overwrites only the fields sent, so a partial
// body is safe. Returns the updated project.
export async function updateProject(id: number, fields: Record<string, unknown>): Promise<DolibarrProject> {
  return dolibarr.put<DolibarrProject>(`/projects/${id}`, fields);
}

// Validates a draft project, and also reopens a closed one (the Dolibarr UI
// reopens with the same setValid call). Already open answers 304.
export async function validateProject(id: number): Promise<void> {
  // An empty body is rejected with 403 by Dolibarr, so always send notrigger.
  await dolibarr.post(`/projects/${id}/validate`, { notrigger: 0 });
}

// Links a user to the project with a role, for example PROJECTLEADER.
export async function addProjectUserContact(
  projectId: number,
  userId: number,
  typeContact: "PROJECTLEADER" | "PROJECTCONTRIBUTOR",
): Promise<void> {
  await dolibarr.post(`/projects/${projectId}/contacts`, {
    fk_socpeople: userId,
    type_contact: typeContact,
    source: "internal",
  });
}

// Tasks of a project, with duration_effective (seconds spent) on each task.
// GET /projects/{id}/tasks only returns tasks the API user is assigned to (an
// empty list on the demo), so list /tasks filtered on the project instead.
export async function listProjectTasks(projectId: number): Promise<DolibarrTask[]> {
  return listAllPages((page, pageSize) =>
    listTasks(dolibarrQueryString({
      sqlfilters: `(t.fk_projet:=:${projectId})`,
      sortfield: "t.rowid",
      sortorder: "ASC",
      limit: String(pageSize),
      page: String(page),
    })),
  );
}

export async function getTask(id: number, options?: DolibarrRequestOptions): Promise<DolibarrTask> {
  return dolibarr.get<DolibarrTask>(`/tasks/${id}`, options);
}

export async function listTasks(params: string): Promise<DolibarrTask[]> {
  try {
    return await dolibarr.get<DolibarrTask[]>(`/tasks?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

// POST /projects/{id}/tasks is commented out in Dolibarr; tasks are created
// through /tasks with ref, label and fk_project required.
export async function createTask(data: {
  ref: "auto";
  label: string;
  fk_project: number;
  description?: string;
  fk_task_parent?: number;
  date_start?: number;
  date_end?: number;
  planned_workload?: number;
  billable?: 0 | 1;
}): Promise<number> {
  return dolibarr.post<number>("/tasks", data);
}

// Dolibarr refuses (500) a task with subtasks or time entries.
export async function deleteTask(id: number): Promise<void> {
  await dolibarr.delete(`/tasks/${id}`);
}

// PUT fetches the task and overwrites only the fields sent.
export async function updateTask(id: number, fields: Record<string, unknown>): Promise<DolibarrTask> {
  return dolibarr.put<DolibarrTask>(`/tasks/${id}`, fields);
}

// `date` is "YYYY-MM-DD HH:MM:SS" in GMT; duration is in seconds; user_id 0
// means the API user. The response carries no ID of the new time entry.
export async function addTimeSpent(
  taskId: number,
  data: { date: string; duration: number; user_id?: number; note?: string; progress?: number },
): Promise<void> {
  await dolibarr.post(`/tasks/${taskId}/addtimespent`, data);
}

// One time entry. Dolibarr does not check that it belongs to `taskId`, so
// callers take the task from the entry's fk_element.
export async function getTimeSpentEntry(
  taskId: number,
  entryId: number,
  options?: DolibarrRequestOptions,
): Promise<DolibarrTimeSpentEntry> {
  return dolibarr.get<DolibarrTimeSpentEntry>(`/tasks/${taskId}/getTimeSpent/${entryId}`, options);
}

// Overwrites date, duration, product and note with what is sent, so callers
// send the current value of every field they do not change. A user_id of 0
// keeps the current user. `date` is "YYYY-MM-DD HH:MM:SS" in GMT.
export async function updateTimeSpent(
  taskId: number,
  entryId: number,
  data: { date: string; duration: number; user_id: number; note: string; product_id?: number | null },
): Promise<void> {
  await dolibarr.put(`/tasks/${taskId}/timespent/${entryId}`, data);
}

// Also subtracts the duration from the task's duration_effective.
export async function deleteTimeSpent(taskId: number, entryId: number): Promise<void> {
  await dolibarr.delete(`/tasks/${taskId}/timespent/${entryId}`);
}

export async function listTimeSpent(params: string): Promise<DolibarrTimeSpentRow[]> {
  try {
    return await dolibarr.get<DolibarrTimeSpentRow[]>(`/projects/alltimespent?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

// Time entries matching `sqlfilters` over the aliases p (project), t (task),
// et (time entry) and s (thirdparty), most recent first. The endpoint's own
// thirdparty_ids parameter filters on t.fk_soc, a column tasks do not have, so
// callers filter on (p.fk_soc:=:id) instead.
export async function listAllTimeSpent(sqlfilters?: string): Promise<DolibarrTimeSpentRow[]> {
  return listAllPages((page, pageSize) =>
    listTimeSpent(dolibarrQueryString({
      sortfield: "et.element_datehour",
      sortorder: "DESC",
      limit: String(pageSize),
      page: String(page),
      ...(sqlfilters ? { sqlfilters } : {}),
    })),
  );
}

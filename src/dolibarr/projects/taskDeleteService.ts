import { mapWithConcurrency } from "../concurrency.js";
import { isDolibarrNotFoundError } from "../errors.js";
import { deleteTask, deleteTimeSpent, getTask, getTimeSpentEntry, listProjectTasks } from "../projects.js";
import { queryTimeEntries, totalHours } from "./projectReadService.js";
import { isInvoiced } from "./timeEntryService.js";
import { cleanString, numberOrUndefined } from "../../tools/shared/normalization.js";
import type { DolibarrTask } from "../../types/dolibarr.js";
import type { McpError } from "../../types/tools.js";

const entryLookupConcurrency = 4;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export interface TaskDeleteDeps {
  listProjectTasks: typeof listProjectTasks;
  queryTimeEntries: typeof queryTimeEntries;
  getTimeSpentEntry: typeof getTimeSpentEntry;
  deleteTimeSpent: typeof deleteTimeSpent;
  deleteTask: typeof deleteTask;
  getTask: typeof getTask;
}

const defaultDeps: TaskDeleteDeps = {
  listProjectTasks,
  queryTimeEntries,
  getTimeSpentEntry,
  deleteTimeSpent,
  deleteTask,
  getTask,
};

export interface TaskDeleteInput {
  confirm: boolean;
  /** Delete the task's time entries first; Dolibarr refuses a task that has any. */
  deleteTimeEntries: boolean;
}

// Dolibarr refuses to delete a task with subtasks or time entries (element_time
// is a child table of tasks). This flow reports both in the dry run, deletes
// time entries only when asked, never deletes invoiced time, and checks the
// task is gone afterwards.
export class TaskDeleteService {
  private readonly deps: TaskDeleteDeps;

  constructor(deps: Partial<TaskDeleteDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async delete(task: DolibarrTask, input: TaskDeleteInput): Promise<Record<string, unknown>> {
    const taskId = Number(task.id);
    const projectId = Number(task.fk_project);

    const [projectTasks, entries] = await Promise.all([
      this.deps.listProjectTasks(projectId),
      this.deps.queryTimeEntries({ taskId }),
    ]);
    const subtasks = projectTasks.filter((candidate) => Number(candidate.fk_task_parent) === taskId);
    const hours = totalHours(entries);
    const projectRef = cleanString(entries[0]?.project_ref);

    const subtaskList = subtasks.map((subtask) => ({
      id: Number(subtask.id),
      ref: subtask.ref,
      label: cleanString(subtask.label),
    }));

    const blocked = subtasks.length > 0
      ? "subtasks"
      : entries.length > 0 && !input.deleteTimeEntries ? "time_entries" : undefined;

    if (!input.confirm) {
      return {
        delete_enabled: true,
        dry_run: true,
        would_delete: blocked === undefined,
        entity_type: "task",
        id: taskId,
        ref: task.ref,
        label: cleanString(task.label),
        project_id: projectId,
        ...(projectRef ? { project_ref: projectRef } : {}),
        linked: { subtasks: subtasks.length, time_entries: entries.length, hours },
        ...(blocked === "subtasks" ? { blocked_reason: "The task has subtasks; delete or move them first." } : {}),
        ...(blocked === "time_entries"
          ? { blocked_reason: `The task has ${plural(entries.length, "time entry", "time entries")} (${hours} h). Pass delete_time_entries:true to delete them with the task.` }
          : {}),
      };
    }

    if (subtasks.length > 0) {
      return {
        error: "TASK_HAS_SUBTASKS",
        message: `Task ${task.ref} has ${plural(subtasks.length, "subtask")}; Dolibarr does not delete a task with subtasks.`,
        action: "Delete or move the subtasks first.",
        candidates: subtaskList,
      } satisfies McpError;
    }

    if (entries.length > 0 && !input.deleteTimeEntries) {
      return {
        error: "TASK_HAS_TIME",
        message: `Task ${task.ref} has ${plural(entries.length, "time entry", "time entries")} (${hours} h); Dolibarr does not delete a task with time logged.`,
        action: "Re-run with delete_time_entries:true to delete the time with the task, or move the work elsewhere first.",
      } satisfies McpError;
    }

    // Check every entry before deleting any, so invoiced time stops the whole run.
    const details = await mapWithConcurrency(entries, entryLookupConcurrency, (row) =>
      this.deps.getTimeSpentEntry(taskId, Number(row.rowid)));
    const invoiced = details.filter(isInvoiced);
    if (invoiced.length > 0) {
      return {
        error: "TIME_ENTRY_INVOICED",
        message: `Task ${task.ref} has ${plural(invoiced.length, "invoiced time entry", "invoiced time entries")} (${invoiced.map((entry) => entry.id).join(", ")}); nothing was deleted.`,
        action: "Invoiced time is not deleted by the MCP; handle it in Dolibarr.",
      } satisfies McpError;
    }

    const deletedEntryIds: number[] = [];
    let step = "delete time entries";
    try {
      for (const row of entries) {
        await this.deps.deleteTimeSpent(taskId, Number(row.rowid));
        deletedEntryIds.push(Number(row.rowid));
      }

      step = "delete task";
      await this.deps.deleteTask(taskId);

      step = "check task is gone";
      try {
        await this.deps.getTask(taskId, { suppressErrorStatuses: [404] });
        throw new Error("Dolibarr reported the task as deleted, but it still exists");
      } catch (err) {
        if (!isDolibarrNotFoundError(err)) throw err;
      }
    } catch (err) {
      return {
        error: "DOLIBARR_API_ERROR",
        message: `Deleting task ${task.ref} stopped at '${step}': ${err instanceof Error ? err.message : String(err)}. ${deletedEntryIds.length} of ${entries.length} time entries were already deleted.`,
        task_id: taskId,
        failed_step: step,
        deleted_time_entry_ids: deletedEntryIds,
      };
    }

    return {
      success: true,
      deleted: true,
      task_id: taskId,
      ref: task.ref,
      label: cleanString(task.label),
      deleted_time_entries: deletedEntryIds.length,
      deleted_hours: hours,
      ...(numberOrUndefined(task.fk_project) !== undefined ? { project_id: projectId } : {}),
    };
  }
}

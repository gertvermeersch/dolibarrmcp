import {
  deleteTimeSpent,
  getTask,
  getTimeSpentEntry,
  listTimeSpent,
  updateTimeSpent,
} from "../projects.js";
import { isDolibarrNotFoundError } from "../errors.js";
import { dolibarrQueryString } from "../sqlFilters.js";
import {
  cleanString,
  dolibarrTimeZone,
  isIsoDateString,
  isoDateFromTimestamp,
  numberOrUndefined,
} from "../../tools/shared/normalization.js";
import {
  gmtDateTimeFromLocal,
  hoursFromSeconds,
  isTimeOfDay,
  localTimeFromTimestamp,
  optionalNumber,
  secondsFromHours,
} from "./projectRules.js";
import { DEFAULT_TIME_START } from "./projectWriteService.js";
import type { DolibarrTask, DolibarrTimeSpentEntry, DolibarrTimeSpentRow } from "../../types/dolibarr.js";
import type { McpError } from "../../types/tools.js";

const maxHoursPerEntry = 24;
// After a delete a 404 is the expected answer, not an error to log.
const expectNotFound = { suppressErrorStatuses: [404] };

// A time entry as found by ID: the alltimespent row carries project, task and
// user names; the single-entry read carries the note, start time and invoice.
export interface FoundTimeEntry {
  row: DolibarrTimeSpentRow;
  entry: DolibarrTimeSpentEntry;
  taskId: number;
}

export interface TimeEntryChanges {
  date?: string;
  startTime?: string;
  hours?: number;
  note?: string;
  userId?: number;
}

export interface TimeEntryDeps {
  listTimeSpent: typeof listTimeSpent;
  getTimeSpentEntry: typeof getTimeSpentEntry;
  updateTimeSpent: typeof updateTimeSpent;
  deleteTimeSpent: typeof deleteTimeSpent;
  getTask: typeof getTask;
  timeZone: () => string;
}

const defaultDeps: TimeEntryDeps = {
  listTimeSpent,
  getTimeSpentEntry,
  updateTimeSpent,
  deleteTimeSpent,
  getTask,
  timeZone: dolibarrTimeZone,
};

export function entryNote(entry: DolibarrTimeSpentEntry): string | undefined {
  return cleanString(entry.note_private ?? entry.note);
}

export function isInvoiced(entry: DolibarrTimeSpentEntry): boolean {
  return (numberOrUndefined(entry.invoice_id) ?? 0) > 0;
}

function hasHour(entry: DolibarrTimeSpentEntry): boolean {
  return numberOrUndefined(entry.element_date_withhour) === 1;
}

export function entryLocalDate(entry: DolibarrTimeSpentEntry): string | undefined {
  return isoDateFromTimestamp(entry.element_datehour ?? entry.element_date);
}

export function entryLocalStartTime(entry: DolibarrTimeSpentEntry, timeZone: string): string | undefined {
  return hasHour(entry) ? localTimeFromTimestamp(entry.element_datehour, timeZone) : undefined;
}

export function invoicedError(entryId: number, entry: DolibarrTimeSpentEntry): McpError {
  return {
    error: "TIME_ENTRY_INVOICED",
    message: `Time entry ${entryId} is already on invoice ${entry.invoice_id}; it is left unchanged.`,
    action: "Correct invoiced time in Dolibarr, where the invoice link can be handled too.",
  };
}

export class TimeEntryService {
  private readonly deps: TimeEntryDeps;

  constructor(deps: Partial<TimeEntryDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  timeZone(): string {
    return this.deps.timeZone();
  }

  async find(entryId: number): Promise<{ ok: true; found: FoundTimeEntry } | { ok: false; error: McpError }> {
    const rows = await this.deps.listTimeSpent(dolibarrQueryString({
      sqlfilters: `(et.rowid:=:${entryId})`,
      limit: "1",
    }));
    const row = rows[0];
    const notFound: McpError = {
      error: "TIME_ENTRY_NOT_FOUND",
      message: `No time entry with ID ${entryId}.`,
      action: "Run list_time_entries to find the entry ID.",
    };
    if (!row) return { ok: false, error: notFound };

    const taskId = Number(row.task_id);
    try {
      const entry = await this.deps.getTimeSpentEntry(taskId, entryId);
      return { ok: true, found: { row, entry, taskId } };
    } catch (err) {
      if (isDolibarrNotFoundError(err)) return { ok: false, error: notFound };
      throw err;
    }
  }

  async update(
    found: FoundTimeEntry,
    changes: TimeEntryChanges,
  ): Promise<McpError | { success: true; before: DolibarrTimeSpentEntry; after: DolibarrTimeSpentEntry; task: DolibarrTask; changed: string[] }> {
    const { entry, taskId } = found;
    const entryId = Number(entry.id);

    if (changes.date !== undefined && !isIsoDateString(changes.date)) {
      return { error: "VALIDATION_ERROR", message: "date must be a valid YYYY-MM-DD calendar date." };
    }
    if (changes.startTime !== undefined && !isTimeOfDay(changes.startTime)) {
      return { error: "VALIDATION_ERROR", message: "start_time must be HH:MM, for example 09:30." };
    }
    if (changes.hours !== undefined && (!(changes.hours > 0) || changes.hours > maxHoursPerEntry)) {
      return { error: "VALIDATION_ERROR", message: `hours must be more than 0 and at most ${maxHoursPerEntry}.` };
    }

    const changed = Object.entries({
      date: changes.date,
      start_time: changes.startTime,
      hours: changes.hours,
      note: changes.note,
      user_id: changes.userId,
    }).filter(([, value]) => value !== undefined).map(([key]) => key);
    if (changed.length === 0) {
      return { error: "VALIDATION_ERROR", message: "Nothing to update: pass at least one field to change." };
    }

    if (isInvoiced(entry)) return invoicedError(entryId, entry);

    // Dolibarr overwrites every field from the request, so resend the current
    // values of the fields that do not change.
    const timeZone = this.deps.timeZone();
    const date = changes.date ?? entryLocalDate(entry);
    if (!date) return { error: "VALIDATION_ERROR", message: `Time entry ${entryId} has no date; pass date.` };
    const startTime = changes.startTime ?? entryLocalStartTime(entry, timeZone) ?? DEFAULT_TIME_START;

    await this.deps.updateTimeSpent(taskId, entryId, {
      date: gmtDateTimeFromLocal(date, startTime, timeZone),
      duration: changes.hours !== undefined ? secondsFromHours(changes.hours) : numberOrUndefined(entry.element_duration) ?? 0,
      user_id: changes.userId ?? numberOrUndefined(entry.fk_user) ?? 0,
      note: changes.note ?? entryNote(entry) ?? "",
      product_id: optionalNumber(entry.fk_product) ?? null,
    });

    const [after, task] = await Promise.all([
      this.deps.getTimeSpentEntry(taskId, entryId),
      this.deps.getTask(taskId),
    ]);
    return { success: true, before: entry, after, task, changed };
  }

  // Deletes the entry and checks it is gone: Dolibarr's delete responses are
  // not always trustworthy (see DELETE /projects).
  async remove(found: FoundTimeEntry): Promise<McpError | { success: true; task: DolibarrTask }> {
    const entryId = Number(found.entry.id);
    if (isInvoiced(found.entry)) return invoicedError(entryId, found.entry);

    await this.deps.deleteTimeSpent(found.taskId, entryId);

    try {
      await this.deps.getTimeSpentEntry(found.taskId, entryId, expectNotFound);
      return {
        error: "DOLIBARR_API_ERROR",
        message: `Dolibarr reported time entry ${entryId} as deleted, but it still exists.`,
      };
    } catch (err) {
      if (!isDolibarrNotFoundError(err)) throw err;
    }

    return { success: true, task: await this.deps.getTask(found.taskId) };
  }
}

export function serializeFoundTimeEntry(
  found: { row: DolibarrTimeSpentRow; entry: DolibarrTimeSpentEntry },
  timeZone: string,
): Record<string, unknown> {
  const { row, entry } = found;
  const userName = [row.user_firstname, row.user_lastname].filter(Boolean).join(" ").trim() || row.user_login;
  return Object.fromEntries(Object.entries({
    id: numberOrUndefined(entry.id),
    date: entryLocalDate(entry),
    start_time: entryLocalStartTime(entry, timeZone),
    hours: hoursFromSeconds(entry.element_duration),
    note: entryNote(entry),
    user: cleanString(userName),
    user_id: numberOrUndefined(entry.fk_user),
    invoiced: isInvoiced(entry) || undefined,
    invoice_id: isInvoiced(entry) ? numberOrUndefined(entry.invoice_id) : undefined,
    task_id: numberOrUndefined(row.task_id),
    task_ref: cleanString(row.task_ref),
    task_label: cleanString(row.task_label),
    project_ref: cleanString(row.project_ref),
    project_title: cleanString(row.project_title),
    client_name: cleanString(row.soc_name),
  }).filter(([, value]) => value !== undefined));
}

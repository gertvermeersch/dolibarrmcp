import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hoursFromSeconds } from "../../dolibarr/projects/projectRules.js";
import { serializeFoundTimeEntry, TimeEntryService } from "../../dolibarr/projects/timeEntryService.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { isoDateSchema } from "./projectSchemas.js";

const timeEntryService = new TimeEntryService();

export function registerUpdateTimeEntry(server: McpServer): void {
  registerJsonTool(server, "update_time_entry", {
    description: "Correct a logged time entry by its ID (from list_time_entries or get_project_detail): hours, date, start time, note or user. Fields left out keep their current value. Invoiced time is refused. The entry stays on its task.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      entry_id: z.number().int().positive().describe("Time entry ID"),
      hours: z.number().positive().max(24).optional(),
      date: isoDateSchema.optional().describe("YYYY-MM-DD"),
      start_time: z.string().optional().describe("Local start time HH:MM"),
      note: z.string().optional().describe("Replaces the note; pass an empty string to clear it"),
      user_id: z.number().int().positive().optional().describe("Dolibarr user the time belongs to"),
    },
  }, async ({ entry_id, hours, date, start_time, note, user_id }) => {
    const found = await timeEntryService.find(entry_id);
    if (!found.ok) return found.error;

    const result = await timeEntryService.update(found.found, {
      hours, date, startTime: start_time, note, userId: user_id,
    });
    if (!("success" in result)) return result;

    const timeZone = timeEntryService.timeZone();
    return {
      success: true,
      changed: result.changed,
      before: serializeFoundTimeEntry({ row: found.found.row, entry: result.before }, timeZone),
      after: serializeFoundTimeEntry({ row: found.found.row, entry: result.after }, timeZone),
      task_spent_hours: hoursFromSeconds(result.task.duration_effective),
    };
  });
}

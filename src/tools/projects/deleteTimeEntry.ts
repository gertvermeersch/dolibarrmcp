import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hoursFromSeconds } from "../../dolibarr/projects/projectRules.js";
import { serializeFoundTimeEntry, TimeEntryService } from "../../dolibarr/projects/timeEntryService.js";
import { deletesDisabledResponse } from "../shared/deleteGuards.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";

const timeEntryService = new TimeEntryService();

export function registerDeleteTimeEntry(server: McpServer): void {
  registerJsonTool(server, "delete_time_entry", {
    description: "Delete a logged time entry by its ID (from list_time_entries). Without confirm:true it is a dry run showing the entry. Invoiced time is refused. Requires MCP_ALLOW_DELETES=true.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      entry_id: z.number().int().positive().describe("Time entry ID"),
      confirm: z.boolean().default(false).describe("Must be true to delete. Omit for a dry run."),
    },
  }, async ({ entry_id, confirm }) => {
    const disabled = deletesDisabledResponse();
    if (disabled) return disabled;

    const found = await timeEntryService.find(entry_id);
    if (!found.ok) return found.error;
    const entry = serializeFoundTimeEntry(found.found, timeEntryService.timeZone());

    if (!confirm) {
      return { delete_enabled: true, dry_run: true, would_delete: !entry.invoiced, entity_type: "time_entry", entry };
    }

    const result = await timeEntryService.remove(found.found);
    if (!("success" in result)) return result;

    return {
      success: true,
      deleted: true,
      entry,
      task_spent_hours_after: hoursFromSeconds(result.task.duration_effective),
    };
  });
}

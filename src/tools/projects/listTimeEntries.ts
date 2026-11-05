import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { groupHours, queryTimeEntries, totalHours } from "../../dolibarr/projects/projectReadService.js";
import { resolveProject, resolveTask } from "../../resolvers/project.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { dateRangeError, dateRangeSchema, thirdpartyFilterSchema } from "../shared/listing.js";
import { serializeTimeEntry, timeEntryUserName } from "../shared/projectSerializers.js";
import { defaultPageSize } from "../../dolibarr/pagination.js";

// listAllPages reads at most 10 pages; a full scan may have stopped early.
const scanLimit = defaultPageSize * 10;
import { projectInputSchema } from "./projectSchemas.js";

export function registerListTimeEntries(server: McpServer): void {
  registerJsonTool(server, "list_time_entries", {
    description: "Time logged on project tasks, most recent first, with total hours and breakdowns per project, task and user. Filter by project, task, client, user and date range, for example 'hours on Acme this month' or 'what did I log last week'.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: {
      project: projectInputSchema.optional(),
      task: z.string().min(1).optional().describe("Task ref or ID, or a task label together with project"),
      ...thirdpartyFilterSchema,
      user_id: z.number().int().positive().optional().describe("Dolibarr user ID"),
      ...dateRangeSchema,
      max_entries: z.number().int().min(0).max(500).default(100).describe("Entries to list; totals cover every match up to the scan limit"),
    },
  }, async ({ project, task, thirdparty_id, user_id, date_from, date_to, max_entries }) => {
    const rangeError = dateRangeError({ date_from, date_to });
    if (rangeError) return rangeError;

    let projectId: number | undefined;
    let taskId: number | undefined;
    if (task !== undefined) {
      const resolved = await resolveTask({ task, project });
      if (!resolved.ok) return resolved.error;
      taskId = Number(resolved.task.id);
    } else if (project !== undefined) {
      const resolved = await resolveProject(project);
      if (!resolved.ok) return resolved.error;
      projectId = Number(resolved.project.id);
    }

    const rows = await queryTimeEntries({
      projectId,
      taskId,
      thirdpartyId: thirdparty_id,
      userId: user_id,
      from: date_from,
      to: date_to,
    });

    return {
      total_hours: totalHours(rows),
      count: rows.length,
      by_project: groupHours(rows, (row) => `${row.project_ref} ${row.project_title ?? ""}`.trim())
        .map(({ key, hours, entries }) => ({ project: key, hours, entries })),
      by_task: groupHours(rows, (row) => `${row.project_ref} / ${row.task_label ?? row.task_ref}`)
        .map(({ key, hours, entries }) => ({ task: key, hours, entries })),
      by_user: groupHours(rows, (row) => timeEntryUserName(row) ?? `user ${row.fk_user}`)
        .map(({ key, hours, entries }) => ({ user: key, hours, entries })),
      entries: rows.slice(0, max_entries).map(serializeTimeEntry),
      truncated: rows.length > max_entries,
      ...(rows.length >= scanLimit
        ? { warning: `Stopped after ${scanLimit} entries; totals may be incomplete. Narrow the date range or filters.` }
        : {}),
    };
  });
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { todayIso } from "../../dolibarr/maintenance/contractRules.js";
import { DEFAULT_TIME_START, ProjectWriteService } from "../../dolibarr/projects/projectWriteService.js";
import { hoursFromSeconds } from "../../dolibarr/projects/projectRules.js";
import { resolveTask } from "../../resolvers/project.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeTask } from "../shared/projectSerializers.js";
import { isoDateSchema, percentSchema, projectInputSchema } from "./projectSchemas.js";

const projectWriteService = new ProjectWriteService();

export function registerLogTime(server: McpServer): void {
  registerJsonTool(server, "log_time", {
    description: `Log time spent on a project task. Address the task by ref or ID, or by project plus task label; with only a project, its single task is used, and several tasks return TASK_AMBIGUOUS with the list. Logs for the API user unless user_id is given. Each call adds a new entry, so do not retry a call that succeeded.`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      task: z.string().min(1).optional().describe("Task ref or ID, or its label when project is given"),
      project: projectInputSchema.optional(),
      hours: z.number().positive().max(24).describe("Hours spent, for example 1.5"),
      date: isoDateSchema.optional().describe("YYYY-MM-DD; defaults to today"),
      start_time: z.string().optional().describe(`Local start time HH:MM; defaults to ${DEFAULT_TIME_START}`),
      note: z.string().optional().describe("What was done"),
      user_id: z.number().int().positive().optional().describe("Dolibarr user the time is for; defaults to the API user"),
      progress: percentSchema.optional().describe("Also set the task's progress, in percent"),
    },
  }, async (args) => {
    if (args.task === undefined && args.project === undefined) {
      return { error: "VALIDATION_ERROR", message: "Pass task, or project (with an optional task label)." };
    }

    const resolved = await resolveTask({ task: args.task, project: args.project });
    if (!resolved.ok) return resolved.error;

    const result = await projectWriteService.logTime(resolved.task, {
      date: args.date ?? todayIso(),
      hours: args.hours,
      startTime: args.start_time,
      note: args.note,
      userId: args.user_id,
      progress: args.progress,
    });
    if (!("success" in result)) return result;

    return {
      success: true,
      logged: result.entry,
      task_spent_hours_before: result.spent_hours_before,
      task_spent_hours_after: hoursFromSeconds(result.task.duration_effective),
      task: serializeTask(result.task),
    };
  });
}

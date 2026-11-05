import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectWriteService } from "../../dolibarr/projects/projectWriteService.js";
import { resolveTask } from "../../resolvers/project.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeTask } from "../shared/projectSerializers.js";
import { hoursSchema, isoDateSchema, percentSchema, projectInputSchema } from "./projectSchemas.js";

const projectWriteService = new ProjectWriteService();

export function registerUpdateTask(server: McpServer): void {
  registerJsonTool(server, "update_task", {
    description: "Change a task: label, description, planned hours, dates or progress (100 = done). Address the task by ref or ID, or by its label together with the project. Only the fields passed change; logged time is untouched.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      task: z.string().min(1).describe("Task ref or ID, or its label when project is given"),
      project: projectInputSchema.optional(),
      label: z.string().min(1).optional(),
      description: z.string().optional(),
      planned_hours: hoursSchema.optional(),
      start_date: isoDateSchema.optional(),
      end_date: isoDateSchema.optional(),
      progress: percentSchema.optional().describe("Percent complete; 100 marks the task done"),
    },
  }, async (args) => {
    const resolved = await resolveTask({ task: args.task, project: args.project });
    if (!resolved.ok) return resolved.error;

    const result = await projectWriteService.updateTask(resolved.task, {
      label: args.label,
      description: args.description,
      plannedHours: args.planned_hours,
      startDate: args.start_date,
      endDate: args.end_date,
      progress: args.progress,
    });
    if (!("success" in result)) return result;

    return { success: true, changed: result.changed, task: serializeTask(result.task) };
  });
}

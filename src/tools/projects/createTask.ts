import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectWriteService } from "../../dolibarr/projects/projectWriteService.js";
import { resolveProject, resolveTask } from "../../resolvers/project.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeTask } from "../shared/projectSerializers.js";
import { hoursSchema, isoDateSchema, projectInputSchema } from "./projectSchemas.js";

const projectWriteService = new ProjectWriteService();

export function registerCreateTask(server: McpServer): void {
  registerJsonTool(server, "create_task", {
    description: "Add a task to a project, optionally with planned hours, dates and a parent task. The task is billable when the project bills time, unless billable is given.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      project: projectInputSchema,
      label: z.string().min(1),
      description: z.string().optional(),
      planned_hours: hoursSchema.optional(),
      start_date: isoDateSchema.optional(),
      end_date: isoDateSchema.optional(),
      parent_task: z.string().min(1).optional().describe("Parent task label, ref or ID within the same project"),
      billable: z.boolean().optional(),
    },
  }, async (args) => {
    const resolved = await resolveProject(args.project);
    if (!resolved.ok) return resolved.error;
    const project = resolved.project;

    let parentTaskId: number | undefined;
    if (args.parent_task !== undefined) {
      const parent = await resolveTask({ task: args.parent_task, project: String(project.id) });
      if (!parent.ok) return parent.error;
      parentTaskId = Number(parent.task.id);
    }

    const result = await projectWriteService.createTask(project, {
      label: args.label,
      description: args.description,
      plannedHours: args.planned_hours,
      startDate: args.start_date,
      endDate: args.end_date,
      parentTaskId,
      billable: args.billable,
    });
    if (!("success" in result)) return result;

    return {
      success: true,
      task_id: Number(result.task.id),
      project: { id: Number(project.id), ref: project.ref, title: project.title },
      task: serializeTask(result.task),
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    };
  });
}

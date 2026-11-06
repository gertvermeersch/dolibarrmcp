import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TaskDeleteService } from "../../dolibarr/projects/taskDeleteService.js";
import { resolveTask } from "../../resolvers/project.js";
import { deletesDisabledResponse } from "../shared/deleteGuards.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { projectInputSchema } from "./projectSchemas.js";

const taskDeleteService = new TaskDeleteService();

export function registerDeleteTask(server: McpServer): void {
  registerJsonTool(server, "delete_task", {
    description: "Delete a project task. Without confirm:true it is a dry run listing its subtasks and logged time. A task with subtasks is refused; a task with time is refused unless delete_time_entries:true, which deletes that time too (never invoiced time). Requires MCP_ALLOW_DELETES=true.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      task: z.string().min(1).describe("Task ref or ID, or its label when project is given"),
      project: projectInputSchema.optional(),
      confirm: z.boolean().default(false).describe("Must be true to delete. Omit for a dry run."),
      delete_time_entries: z.boolean().default(false).describe("Also delete the time logged on the task"),
    },
  }, async ({ task, project, confirm, delete_time_entries }) => {
    const disabled = deletesDisabledResponse();
    if (disabled) return disabled;

    const resolved = await resolveTask({ task, project });
    if (!resolved.ok) return resolved.error;

    return taskDeleteService.delete(resolved.task, { confirm, deleteTimeEntries: delete_time_entries });
  });
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectWriteService } from "../../dolibarr/projects/projectWriteService.js";
import { projectStatusLabel } from "../../dolibarr/projects/projectRules.js";
import { resolveProject } from "../../resolvers/project.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { numberOrUndefined } from "../shared/normalization.js";
import { serializeProjectSummary } from "../shared/projectSerializers.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { projectInputSchema } from "./projectSchemas.js";

const projectWriteService = new ProjectWriteService();

export function registerSetProjectStatus(server: McpServer): void {
  registerJsonTool(server, "set_project_status", {
    description: "Open or close a project. open validates a draft or reopens a closed project; closed closes it (a draft is validated first). Nothing is deleted, and tasks and time stay attached.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project: projectInputSchema,
      status: z.enum(["open", "closed"]),
    },
  }, async ({ project: projectInput, status }) => {
    const resolved = await resolveProject(projectInput);
    if (!resolved.ok) return resolved.error;

    const previous = projectStatusLabel(resolved.project);
    const result = await projectWriteService.setStatus(resolved.project, status);
    if (!("success" in result)) return result;

    const socid = numberOrUndefined(result.project.socid);
    const names = await resolveMissingThirdpartyNames(socid && socid > 0 ? [socid] : []);
    return {
      success: true,
      previous_status: previous,
      status: projectStatusLabel(result.project),
      ...(result.steps.length === 0 ? { note: `Project was already ${status}.` } : { steps: result.steps }),
      project: serializeProjectSummary(result.project, names),
    };
  });
}

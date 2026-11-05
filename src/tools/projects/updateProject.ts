import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectWriteService } from "../../dolibarr/projects/projectWriteService.js";
import { resolveProject } from "../../resolvers/project.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { numberOrUndefined } from "../shared/normalization.js";
import { serializeProjectDetail } from "../shared/projectSerializers.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { isoDateSchema, leadStageSchema, percentSchema, projectInputSchema } from "./projectSchemas.js";

const projectWriteService = new ProjectWriteService();

export function registerUpdateProject(server: McpServer): void {
  registerJsonTool(server, "update_project", {
    description: "Change a project or lead: title, description, dates, budget, task/time settings, visibility, and lead fields. Use lead_stage to move a lead through the pipeline; the probability follows the stage unless lead_probability is given. Setting a lead field turns the project into a lead. Only the fields passed change; won or lost does not close the project (use set_project_status).",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      project: projectInputSchema,
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      start_date: isoDateSchema.optional(),
      end_date: isoDateSchema.optional().describe("For a lead, the expected closing date"),
      budget: z.number().min(0).optional(),
      uses_tasks: z.boolean().optional(),
      bills_time: z.boolean().optional(),
      visibility: z.enum(["assigned_contacts", "everyone"]).optional(),
      is_lead: z.boolean().optional().describe("Start (true) or stop (false) following the project as a lead"),
      lead_stage: leadStageSchema.optional(),
      lead_amount: z.number().min(0).optional().describe("Expected amount excluding tax"),
      lead_probability: percentSchema.optional(),
    },
  }, async (args) => {
    const resolved = await resolveProject(args.project);
    if (!resolved.ok) return resolved.error;

    const result = await projectWriteService.updateProject(resolved.project, {
      title: args.title,
      description: args.description,
      startDate: args.start_date,
      endDate: args.end_date,
      budget: args.budget,
      usesTasks: args.uses_tasks,
      billsTime: args.bills_time,
      visibleToEveryone: args.visibility === undefined ? undefined : args.visibility === "everyone",
      isLead: args.is_lead,
      leadStage: args.lead_stage,
      leadAmount: args.lead_amount,
      leadProbability: args.lead_probability,
    });
    if (!("success" in result)) return result;

    const socid = numberOrUndefined(result.project.socid);
    const names = await resolveMissingThirdpartyNames(socid && socid > 0 ? [socid] : []);
    return {
      success: true,
      changed: result.changed,
      project: serializeProjectDetail(result.project, names),
    };
  });
}

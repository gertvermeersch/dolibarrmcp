import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectWriteService } from "../../dolibarr/projects/projectWriteService.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeProjectDetail } from "../shared/projectSerializers.js";
import { isoDateSchema, leadStageSchema, percentSchema } from "./projectSchemas.js";

const projectWriteService = new ProjectWriteService();

export function registerCreateProject(server: McpServer): void {
  registerJsonTool(server, "create_project", {
    description: "Create a project or a lead for an existing thirdparty (never creates the thirdparty). Pass lead to follow it as an opportunity with a stage, amount and probability; the probability defaults to the stage's. The API user becomes project leader and, by default, the project is validated (open).",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      thirdparty: z.string().min(1).describe("Client name, code or Dolibarr ID"),
      title: z.string().min(1),
      description: z.string().optional(),
      start_date: isoDateSchema.optional().describe("YYYY-MM-DD; defaults to today"),
      end_date: isoDateSchema.optional().describe("YYYY-MM-DD; for a lead, the expected closing date"),
      budget: z.number().min(0).optional().describe("Budget excluding tax"),
      uses_tasks: z.boolean().default(true).describe("Track tasks and time on this project"),
      bills_time: z.boolean().default(false).describe("Time spent on this project is billable"),
      visibility: z.enum(["assigned_contacts", "everyone"]).default("assigned_contacts"),
      lead: z.object({
        stage: leadStageSchema.default("prospection"),
        amount: z.number().min(0).optional().describe("Expected amount excluding tax"),
        probability: percentSchema.optional().describe("Percent; defaults to the stage's probability"),
      }).optional().describe("Follow this project as a lead (opportunity)"),
      open: z.boolean().default(true).describe("Validate the project so it is open; false keeps it as a draft"),
    },
  }, async (args) => {
    const thirdparty = await resolveThirdparty(args.thirdparty);
    if (!thirdparty.ok) return thirdparty.error;

    const result = await projectWriteService.createProject({
      thirdpartyId: thirdparty.id,
      title: args.title,
      description: args.description,
      startDate: args.start_date,
      endDate: args.end_date,
      budget: args.budget,
      usesTasks: args.uses_tasks,
      billsTime: args.bills_time,
      visibleToEveryone: args.visibility === "everyone",
      lead: args.lead,
      open: args.open,
    });
    if (!("success" in result)) return result;

    return {
      success: true,
      project_id: Number(result.project.id),
      project: serializeProjectDetail(result.project, new Map([[thirdparty.id, thirdparty.name]])),
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    };
  });
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProjects } from "../../dolibarr/projects.js";
import { projectSqlFilters } from "../../dolibarr/projects/projectReadService.js";
import { leadStageByName, projectStatusCodes } from "../../dolibarr/projects/projectRules.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { listResponse, listWindow, paginationSchema, thirdpartyFilterSchema } from "../shared/listing.js";
import { numberOrUndefined } from "../shared/normalization.js";
import { serializeProjectSummary } from "../shared/projectSerializers.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { leadStageSchema } from "./projectSchemas.js";

export function registerListProjects(server: McpServer): void {
  registerJsonTool(server, "list_projects", {
    description: "Browse projects and leads, newest first. Each has ref, title, client, status (draft, open, closed), dates, budget and, for leads, the stage, amount, probability and weighted amount. Filter by client, status, text in ref/title, leads only, or lead stage.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: {
      ...thirdpartyFilterSchema,
      search: z.string().min(1).optional().describe("Text in the project ref or title"),
      status: z.enum(["draft", "open", "closed"]).optional(),
      leads_only: z.boolean().default(false).describe("Only projects followed as leads (opportunities)"),
      lead_stage: leadStageSchema.optional(),
      ...paginationSchema,
    },
  }, async ({ thirdparty_id, search, status, leads_only, lead_stage, limit, offset }) => {
    const sqlfilters = projectSqlFilters({
      status: status ? projectStatusCodes[status] : undefined,
      leadsOnly: leads_only,
      leadStageId: lead_stage ? leadStageByName(lead_stage).id : undefined,
      search,
    });

    const { rows, hasMore } = await listWindow(listProjects, {
      ...(thirdparty_id !== undefined ? { thirdparty_ids: String(thirdparty_id) } : {}),
      ...(sqlfilters ? { sqlfilters } : {}),
    }, limit, offset);

    const names = await resolveMissingThirdpartyNames(
      rows.flatMap((row) => numberOrUndefined(row.socid) ?? []).filter((id) => id > 0),
    );
    return listResponse("projects", rows.map((row) => serializeProjectSummary(row, names)), limit, offset, hasMore);
  });
}

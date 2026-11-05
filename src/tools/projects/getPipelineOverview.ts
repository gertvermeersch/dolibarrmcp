import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAllProjects } from "../../dolibarr/projects.js";
import { openLeadsSqlFilters } from "../../dolibarr/projects/projectReadService.js";
import { isOpenLead, leadSummary, pipelineSummary } from "../../dolibarr/projects/projectRules.js";
import { todayIso } from "../../dolibarr/maintenance/contractRules.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { thirdpartyFilterSchema } from "../shared/listing.js";
import { numberOrUndefined } from "../shared/normalization.js";
import { serializeProjectSummary } from "../shared/projectSerializers.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";

export function registerGetPipelineOverview(server: McpServer): void {
  registerJsonTool(server, "get_pipeline_overview", {
    description: "Sales pipeline of open leads (projects followed as opportunities that are not closed, won or lost): count, total and probability-weighted amount per stage, every open lead by weighted amount, leads past their end date (expected close), and leads without an amount.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: { ...thirdpartyFilterSchema },
  }, async ({ thirdparty_id }) => {
    const projects = (await listAllProjects({ thirdpartyId: thirdparty_id, sqlfilters: openLeadsSqlFilters }))
      .filter(isOpenLead);
    const summary = pipelineSummary(projects, todayIso());
    const names = await resolveMissingThirdpartyNames(
      projects.flatMap((project) => numberOrUndefined(project.socid) ?? []).filter((id) => id > 0),
    );
    const serialize = (project: (typeof projects)[number]) => serializeProjectSummary(project, names);

    const leads = [...projects].sort((a, b) =>
      (leadSummary(b)?.weighted_amount ?? 0) - (leadSummary(a)?.weighted_amount ?? 0));

    return {
      open_leads: summary.open_leads,
      total_amount: summary.total_amount,
      weighted_amount: summary.weighted_amount,
      by_stage: summary.by_stage,
      leads: leads.map(serialize),
      overdue: summary.overdue.map(serialize),
      without_amount: summary.without_amount.map((project) => ({ id: Number(project.id), ref: project.ref, title: project.title })),
    };
  });
}

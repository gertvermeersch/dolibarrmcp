import { listInvoices } from "../invoices.js";
import { listOrders } from "../orders.js";
import { listProposals } from "../proposals.js";
import { listSupplierInvoices } from "../supplierInvoices.js";
import { listAllTimeSpent, listProjectTasks } from "../projects.js";
import { dolibarrLikeLiteral, dolibarrQueryString, dolibarrStringLiteral } from "../sqlFilters.js";
import { optionalSearch } from "../../tools/shared/thirdpartyNames.js";
import { hoursFromSeconds, isoDateFromDbDateTime, PROJECT_STATUS_CLOSED } from "./projectRules.js";
import { numberOrUndefined } from "../../tools/shared/normalization.js";
import type {
  DolibarrInvoice,
  DolibarrOrder,
  DolibarrProject,
  DolibarrProposal,
  DolibarrTask,
  DolibarrTimeSpentRow,
} from "../../types/dolibarr.js";

export interface ProjectFilters {
  status?: number;
  /** Only projects followed as leads. */
  leadsOnly?: boolean;
  leadStageId?: number;
  /** Substring of the ref or title. */
  search?: string;
}

// sqlfilters for GET /projects. Conditions are AND-ed.
export function projectSqlFilters(filters: ProjectFilters): string | undefined {
  const conditions = [
    ...(filters.status !== undefined ? [`(t.fk_statut:=:${filters.status})`] : []),
    ...(filters.leadsOnly ? ["(t.usage_opportunity:=:1)"] : []),
    ...(filters.leadStageId !== undefined ? [`(t.fk_opp_status:=:${filters.leadStageId})`] : []),
    ...(filters.search
      ? [`((t.ref:like:${dolibarrLikeLiteral(filters.search)}) or (t.title:like:${dolibarrLikeLiteral(filters.search)}))`]
      : []),
  ];
  return conditions.length > 0 ? conditions.join(" and ") : undefined;
}

// Leads that are not closed. Won/lost leads that were left open are filtered
// out afterwards by isOpenLead.
export const openLeadsSqlFilters = `(t.usage_opportunity:=:1) and (t.fk_statut:<:${PROJECT_STATUS_CLOSED})`;

export interface TimeEntryFilters {
  projectId?: number;
  thirdpartyId?: number;
  taskId?: number;
  userId?: number;
  from?: string;
  to?: string;
}

// sqlfilters for GET /projects/alltimespent. Dates compare against the
// entry's calendar date (et.element_date).
export function timeEntrySqlFilters(filters: TimeEntryFilters): string | undefined {
  const conditions = [
    ...(filters.projectId !== undefined ? [`(p.rowid:=:${filters.projectId})`] : []),
    ...(filters.thirdpartyId !== undefined ? [`(p.fk_soc:=:${filters.thirdpartyId})`] : []),
    ...(filters.taskId !== undefined ? [`(t.rowid:=:${filters.taskId})`] : []),
    ...(filters.userId !== undefined ? [`(et.fk_user:=:${filters.userId})`] : []),
    ...(filters.from ? [`(et.element_date:>=:${dolibarrStringLiteral(filters.from)})`] : []),
    ...(filters.to ? [`(et.element_date:<=:${dolibarrStringLiteral(filters.to)})`] : []),
  ];
  return conditions.length > 0 ? conditions.join(" and ") : undefined;
}

export async function queryTimeEntries(filters: TimeEntryFilters): Promise<DolibarrTimeSpentRow[]> {
  return listAllTimeSpent(timeEntrySqlFilters(filters));
}

export interface HoursBreakdown {
  key: string;
  hours: number;
  entries: number;
}

// Sum hours over time entries, grouped by `keyOf`, largest first.
export function groupHours(
  rows: DolibarrTimeSpentRow[],
  keyOf: (row: DolibarrTimeSpentRow) => string,
): HoursBreakdown[] {
  const groups = new Map<string, { seconds: number; entries: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? { seconds: 0, entries: 0 };
    group.seconds += numberOrUndefined(row.element_duration) ?? 0;
    group.entries++;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, hours: hoursFromSeconds(group.seconds), entries: group.entries }))
    .sort((a, b) => b.hours - a.hours);
}

export function totalHours(rows: DolibarrTimeSpentRow[]): number {
  return hoursFromSeconds(rows.reduce((sum, row) => sum + (numberOrUndefined(row.element_duration) ?? 0), 0));
}

export function lastEntryDate(rows: DolibarrTimeSpentRow[]): string | undefined {
  const dates = rows.map((row) => isoDateFromDbDateTime(row.element_datehour)).filter((date): date is string => !!date);
  return dates.length > 0 ? dates.reduce((latest, date) => (date > latest ? date : latest)) : undefined;
}

export interface ProjectLinkedDocuments {
  proposals: DolibarrProposal[];
  orders: DolibarrOrder[];
  invoices: DolibarrInvoice[];
  supplierInvoices: DolibarrInvoice[];
}

export interface ProjectDetailData {
  tasks: DolibarrTask[];
  timeEntries: DolibarrTimeSpentRow[];
  documents: ProjectLinkedDocuments;
}

const linkedDocumentLimit = "100";

function linkedDocumentParams(projectId: number): string {
  return dolibarrQueryString({
    sqlfilters: `(t.fk_projet:=:${projectId})`,
    sortfield: "t.rowid",
    sortorder: "DESC",
    limit: linkedDocumentLimit,
  });
}

export interface ProjectDetailDeps {
  listProjectTasks: typeof listProjectTasks;
  queryTimeEntries: typeof queryTimeEntries;
  listProposals: typeof listProposals;
  listOrders: typeof listOrders;
  listInvoices: typeof listInvoices;
  listSupplierInvoices: typeof listSupplierInvoices;
}

const defaultDetailDeps: ProjectDetailDeps = {
  listProjectTasks,
  queryTimeEntries,
  listProposals,
  listOrders,
  listInvoices,
  listSupplierInvoices,
};

// Everything hanging off a project: tasks, time entries and the documents
// linked through fk_projet. A module the API user cannot read contributes
// nothing instead of failing the whole detail.
export async function loadProjectDetail(
  project: DolibarrProject,
  deps: Partial<ProjectDetailDeps> = {},
): Promise<ProjectDetailData> {
  const d = { ...defaultDetailDeps, ...deps };
  const projectId = Number(project.id);
  const params = linkedDocumentParams(projectId);

  const [tasks, timeEntries, proposals, orders, invoices, supplierInvoices] = await Promise.all([
    d.listProjectTasks(projectId),
    d.queryTimeEntries({ projectId }),
    optionalSearch(() => d.listProposals(params)),
    optionalSearch(() => d.listOrders(params)),
    optionalSearch(() => d.listInvoices(params)),
    optionalSearch(() => d.listSupplierInvoices(params)),
  ]);

  return { tasks, timeEntries, documents: { proposals, orders, invoices, supplierInvoices } };
}

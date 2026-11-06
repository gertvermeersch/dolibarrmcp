# Dolibarr MCP — Agent Guide

This file is the primary context document for AI coding agents working on this repository.
Read it fully before making any changes.

---

## What this project is

A TypeScript MCP (Model Context Protocol) server that exposes Dolibarr ERP/CRM operations
to LLM clients (Claude.ai, Open WebUI, n8n, etc.). It runs as a standalone Docker service
and connects to any Dolibarr instance via its REST API.

The server implements **thick, task-oriented tools** — not thin 1:1 REST wrappers. Each tool
completes a full business operation in a single call, handles all Dolibarr API fan-out
internally, and returns denormalized, LLM-ready output.

---

## Project structure

```
src/
├── index.ts          Entry point — HTTP server, X-API-Key / Bearer auth, MCP wiring
├── server.ts         Registers all tools with the MCP server instance
├── config.ts         Reads and validates env vars; throws on startup if any are missing
├── types/
│   ├── dolibarr.ts   TypeScript types for raw Dolibarr API responses
│   └── tools.ts      Shared types: McpError, error codes, LineItemInput, etc.
├── dolibarr/
│   ├── client.ts     Fetch wrapper — sets DOLAPIKEY header, normalises errors
│   ├── documents/    Domain services for shared document workflows
│   ├── maintenance/  Contract and intervention rules and services (see below)
│   ├── projects/     Project, lead, task and time rules and services (see below)
│   ├── thirdparties.ts
│   ├── invoices.ts
│   ├── supplierInvoices.ts
│   ├── proposals.ts
│   ├── contracts.ts
│   ├── interventions.ts
│   ├── projects.ts   Projects, tasks and time entries
│   ├── users.ts
│   └── products.ts
├── resolvers/
│   ├── thirdparty.ts Fuzzy name → ID resolution with structured errors
│   ├── project.ts    Project (ID / ref / title) and task (ID / ref / label in project) resolution
│   └── product.ts    Catalog match → line item, with free-text fallback
└── tools/
    ├── catalog/      Product and service catalog tools
    ├── contracts/    Maintenance contract tools
    ├── interventions/ Intervention tools
    ├── invoices/     Client/supplier invoice and receivables tools
    ├── payments/     Payment-mode and bank-account discovery tools
    ├── projects/     Project, lead, task and time tracking tools
    ├── proposals/    Proposal/quote tools
    ├── search/       Cross-domain search tools
    ├── shared/       Shared schemas and response helpers for tool handlers
    └── thirdparties/ Client/supplier identity tools
```

---

## Key architectural patterns

### Layer separation

- **`tools/`** — MCP layer. Defines the tool schema (Zod), calls domain services or Dolibarr modules, formats the response. No raw fetch calls here.
- **`dolibarr/documents/`** — Domain service layer for workflows that span resources, such as resolving thirdparties and lines before creating invoices or proposals.
- **`dolibarr/`** — API layer. Raw Dolibarr REST calls, one file per resource. No business logic.
- **`resolvers/`** — Shared logic. Fuzzy matching and resolution patterns used by multiple tools.

Keep MCP handlers thin. If a tool starts orchestrating several business steps, move that flow
into a domain service and let the tool file focus on schema and response shape.

### Resolve-or-fail (thirdparty)

Any tool that needs a `fk_soc` (thirdparty ID) calls `resolveThirdparty(name)` first:
- 1 match → proceeds with the ID
- Multiple matches → returns `THIRDPARTY_AMBIGUOUS` with candidates
- No match → returns `THIRDPARTY_NOT_FOUND` with an action hint

Tools **never** auto-create thirdparties to avoid ERP duplicates.

### Try-resolve-then-fallback (line items)

Each invoice/proposal line calls `resolveLine(input, index)`:
- Catalog match → uses product ID, inherits VAT rate and price
- No match → free-text line, requires `unit_price` and `vat_rate` from the caller
- Missing price on free-text → returns a `VALIDATION_ERROR` before any Dolibarr call is made

### Error format

All tool errors return structured JSON, never plain strings:

```ts
{ error: "THIRDPARTY_NOT_FOUND", message: "...", action: "..." }
{ error: "THIRDPARTY_AMBIGUOUS", message: "...", candidates: [...] }
{ error: "VALIDATION_ERROR", message: "...", line_errors: [...] }
{ error: "DOLIBARR_API_ERROR", message: "..." }
```

Error codes are defined in `src/types/tools.ts` as the `McpErrorCode` union type.
Add new codes there if needed; never use ad-hoc string literals.

---

## Dolibarr API conventions

- Base URL comes from `config.dolibarrUrl` (e.g. `http://host.docker.internal/api/index.php`)
- Auth header: `DOLAPIKEY: <token>` (set automatically by `dolibarr/client.ts`)
- Dates are Unix timestamps (seconds), not ISO strings — convert with `Math.floor(new Date(str).getTime() / 1000)`
- Thirdparty flags: `client: 1` = client, `supplier: 1` = supplier (both can be 1 simultaneously)
- Supplier invoices use a separate endpoint family: `/supplierinvoices`, not `/invoices`
- Proposal status flow: draft → validate → close (accepted or refused); `setProposalStatus` posts numeric close statuses (`2` accepted, `3` refused)

### Maintenance contracts and interventions

`src/dolibarr/maintenance/` holds the domain layer for the maintenance tools:

- `contractRules.ts` — pure derivations (end date, status, yearly value, renewal detection, next
  period, intervention date/duration). Takes "today" as a parameter; no I/O.
- `contractReadService.ts` — list/detail/overview flows (per-contract fan-out for linked invoices).
- `contractCreationService.ts`, `renewalInvoiceService.ts`, `interventionCreationService.ts`,
  `contractStatusService.ts` — write flows with injectable dependencies for unit tests. When a
  step after the first write fails they return an error with the ID of the record already
  created and never roll back by deleting.

API facts verified against the demo (Dolibarr 24):

- A contract has no end date; it is the latest line `date_end`. `GET /contracts` (list) has no
  `linkedObjectsIds`; `GET /contracts/{id}` does (invoices under `facture`).
- `POST /contracts` requires `commercial_signature_id` and `commercial_suivi_id`.
- Lines: `POST /contracts/{id}/lines`, then `POST /contracts/{id}/validate` (send a body) and
  `PUT /contracts/{id}/lines/{lineid}/activate`. The `unactivate` route and `POST /close` both
  close lines (status 5). `closeAll` validates a draft contract as a side effect.
- An invoice links to a contract only with `"linked_objects": {"contrat": <id>}` in
  `POST /invoices`; `origin`/`origin_type` are ignored.
- `POST /interventions` requires `fk_project` (0 works); `fk_contrat` links the contract. Lines
  go through `POST /interventions/{id}/lines`, then `/validate` and `/close` (status 3 = done).
- `GET /thirdparties` returns 404 for no results (empty list). A non-admin API user gets 403 on
  `/setup/company` and `/setup/modules`; that is not a tool error.

### Projects, leads, tasks and time

`src/dolibarr/projects/` holds the domain layer for the project tools:

- `projectRules.ts`: pure derivations (lead stage dictionary, weighted amount, pipeline
  totals, planned vs. spent hours, local time → GMT). No I/O.
- `projectReadService.ts`: sqlfilters for projects and time entries, and the
  `get_project_detail` fan-out.
- `projectWriteService.ts`: create/update/status for projects, create/update for tasks, and
  logging time, with injectable dependencies for unit tests. Records already created are never
  deleted.
- `timeEntryService.ts`: find a time entry by ID, correct it (resending unchanged fields) or
  delete it; invoiced time is refused.
- `taskDeleteService.ts`: guarded task delete (subtasks refused, time deleted only on request,
  never invoiced time, gone-check afterwards).

API facts verified against the demo (Dolibarr 24.0.0, non-admin API user) on 2026-11-05:

- A lead is a project with `usage_opportunity = 1`. The stage is `opp_status` (an ID in
  `llx_c_lead_status`) on read and on write; `fk_opp_status` is only the database column.
  There is no REST endpoint for the dictionary. The IDs are the defaults 1 PROSP … 7 LOST,
  with `PROJECT_USE_OPPORTUNITIES` enabled.
- `POST /projects` and `POST /tasks` require `ref` (send `"auto"` for the next number) and
  `title` / `label` + `fk_project`. `POST /projects/{id}/tasks` is commented out upstream.
- The API does not add the creating user as `PROJECTLEADER`, unlike the UI. The tool adds
  it with `POST /projects/{id}/contacts` (`fk_socpeople`, `type_contact`,
  `source: "internal"`). Upstream that route is declared twice with the same arguments.
- `GET /projects/{id}/tasks` only returns tasks the API user is assigned to; for a
  non-admin API user that is usually none. List tasks with
  `GET /tasks?sqlfilters=(t.fk_projet:=:id)` instead, which returns every task with
  `planned_workload`, `duration_effective` and `progress`.
- `opp_amount` and `budget_amount` come back as `null` when unset; treat that as "no amount",
  not 0 (`optionalMoney` in `projectRules.ts`).
- Reopening keeps `date_close` on the project; only report it while the status is closed.
- `DELETE /projects/{id}` answers "Project deleted" even when the delete fails (it tests
  `!delete()`, and -1 is truthy). A project with tasks or time stays. Delete time entries
  (`DELETE /tasks/{id}/timespent/{tid}`) and tasks first, then check for a 404.
- `PUT /tasks/{id}/timespent/{tid}` overwrites date, duration, product and note with what is
  sent (missing ones become empty), so `update_time_entry` resends the current values;
  `user_id` 0 keeps the user. `GET /tasks/{id}/getTimeSpent/{tid}` returns the note in
  `note_private` (`note` is null), timestamps for the dates, and `invoice_id`. It does not
  check that the entry belongs to the task in the URL, so take the task from `fk_element`
  or from `alltimespent` filtered on `(et.rowid:=:id)`.
- `DELETE /tasks/{id}` refuses (500) a task with subtasks or with time entries
  (`element_time` is a child table of tasks). `DELETE /tasks/{id}/timespent/{tid}` also
  lowers the task's `duration_effective`.
- `PUT /projects/{id}` and `PUT /tasks/{id}` fetch the record and overwrite only the fields
  sent, so partial bodies are safe (unlike document line PUTs).
- Project status: 0 draft, 1 open, 2 closed. `POST /projects/{id}/validate` (send a body)
  opens a draft and reopens a closed project. There is no close route; closing uses `PUT` with
  `status: 2`, which skips the `PROJECT_CLOSE` trigger.
- `POST /tasks/{id}/addtimespent` takes `date` as "YYYY-MM-DD HH:MM:SS" in GMT, `duration` in
  seconds and `user_id` (0 = API user). It returns no ID. `duration_effective` on the task is
  the total seconds spent. `alltimespent` returns `element_datehour` in the server's local
  time (14:30 Brussels for an entry sent as 13:30 GMT).
- `GET /projects/alltimespent` returns raw SQL rows (dates are DB strings). Its
  `thirdparty_ids` filter uses `t.fk_soc` on the task table, which has no such column, so
  filter with `sqlfilters` on `p.fk_soc`. Aliases: `p` project, `t` task, `et` time entry,
  `s` thirdparty, `u` user.
- Proposals, orders, invoices, supplier invoices and interventions link to a project through
  `fk_projet` (filter `(t.fk_projet:=:id)`).

## Local Dolibarr source reference

A local Dolibarr source tree is available at `vendor/dolibarr/`. Treat it as read-only
upstream reference material, not as code owned by this MCP project.

Use it to confirm REST endpoint paths, request bodies, status constants, and version-specific
behavior before changing API wrappers or tool flows. Useful entry points include:

- `vendor/dolibarr/htdocs/comm/propal/class/api_proposals.class.php`
- `vendor/dolibarr/htdocs/compta/facture/class/api_invoices.class.php`
- `vendor/dolibarr/htdocs/fourn/class/api_supplier_invoices.class.php`
- `vendor/dolibarr/htdocs/product/class/api_products.class.php`
- `vendor/dolibarr/htdocs/societe/class/api_thirdparties.class.php`

---

## Environment variables

See `.env.example`. All vars are required at startup except `MCP_HTTP_HOST` and `MCP_HTTP_PORT`
which default to `0.0.0.0:3000`.

```
MCP_API_KEY        Secret used to authenticate incoming MCP requests (X-API-Key header or Authorization: Bearer)
DOLIBARR_URL       Full base URL to Dolibarr REST API
DOLIBARR_API_KEY   Dolibarr personal API token
DOLIBARR_DEBUG     Optional: true/1/yes/on logs Dolibarr requests and responses
DOLIBARR_DEFAULT_COMMERCIAL_ID  Optional: Dolibarr user ID set as representative on new contracts (default: API user)
MCP_HTTP_HOST      Default: 0.0.0.0
MCP_HTTP_PORT      Default: 3000
```

---

## Running locally

```bash
cp .env.example .env
# fill in .env values

docker compose up   # starts with tsx watch + volume mount for live reload
```

On Linux, `host.docker.internal` resolves via the `extra_hosts` entry in `docker-compose.yml`.
On Docker Desktop (Windows/Mac), it resolves automatically.

---

## Adding a new tool

1. Create the tool under the owning domain folder, for example `src/tools/invoices/<toolName>.ts`
2. Export a `register<ToolName>(server: McpServer): void` function
3. Import and call it in `src/server.ts`
4. Add any new Dolibarr API calls to the appropriate file in `src/dolibarr/`
5. Add new types to `src/types/dolibarr.ts` or `src/types/tools.ts` as needed

Follow `src/dolibarr/documents/documentCreationService.ts` for new tools that create
invoice-like or proposal-like documents with thirdparty resolution and line items.
Follow `src/dolibarr/documents/documentUpdateService.ts` for tools that edit draft documents.
Dolibarr's line PUT endpoints reset any field missing from the body, so line edits must go
through `mergeLineUpdate`.

---

## What is and isn't implemented

### Fully implemented
- `list_invoices`, `list_proposals`, `list_orders`, `list_contracts`, `list_payments`, `list_products` (read; filtered browsing and pagination)
- `get_client_overview` (read)
- `get_invoice_detail` (read)
- `get_monthly_revenue` (read)
- `get_outstanding_receivables` (read)
- `search_across` (read)
- `search_document_content` (read)
- `search_products` (read)
- `search_services` (read)
- `update_product` and `update_service` (write; catalog items, type is never changed)
- `search_thirdparties` (read)
- `create_thirdparty` (write)
- `update_thirdparty` (write)
- `create_invoice` (write)
- `update_invoice` (write; draft only)
- `create_supplier_invoice` (write)
- `update_supplier_invoice` (write; draft only)
- `validate_invoice` (write)
- `create_proposal` (write)
- `update_proposal` (write; draft only)
- `validate_proposal` (write)
- `set_proposal_status` (write)
- `mark_invoice_paid` (write; client and supplier invoices, with optional payment creation)
- `list_contracts_by_expiry`, `get_contract_detail`, `get_maintenance_overview`, `list_interventions` (read; maintenance)
- `create_contract`, `create_renewal_invoice`, `create_intervention`, `set_contract_status` (write; maintenance, nothing is deleted)
- `list_payment_modes` and `list_bank_accounts` (read; payment option discovery)
- `list_projects`, `get_project_detail`, `get_pipeline_overview`, `list_time_entries` (read; projects, leads and time)
- `create_project`, `update_project`, `set_project_status`, `create_task`, `update_task`, `log_time`, `update_time_entry` (write; projects, leads, tasks and time)
- `delete_time_entry`, `delete_task` (guarded deletes: `MCP_ALLOW_DELETES=true` and `confirm: true`)
- `resolveThirdparty` resolver
- `resolveLine` resolver
- `dolibarr/client.ts` — fetch wrapper + error normalisation
- All `dolibarr/*.ts` API modules

See `todo.md` for detailed task breakdowns and remaining verification work.

# Dolibarr MCP

This project is a TypeScript MCP server that exposes task-oriented Dolibarr ERP/CRM tools.
It connects to Dolibarr through the REST API and serves MCP over HTTP.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a local environment file:

   ```sh
   cp .env.example .env
   ```

3. Fill in these values:

   | Variable | Description |
   | --- | --- |
   | `MCP_API_KEY` | Secret expected from MCP clients in the `X-API-Key` header, or as `Authorization: Bearer <secret>`. |
   | `DOLIBARR_URL` | Full Dolibarr REST API base URL, for example `http://host.docker.internal/api/index.php`. |
   | `DOLIBARR_API_KEY` | API token from the Dolibarr user account. |
   | `DOLIBARR_TIMEZONE` | Optional. Business timezone for Dolibarr date-only fields. Defaults to `Europe/Brussels`. |
   | `DOLIBARR_DEBUG` | Optional. Set to `true` to log Dolibarr requests and responses to the console. |
   | `DOLIBARR_DEFAULT_WAREHOUSE_ID` | Optional. Default warehouse used when reopening validated customer invoices that may reverse stock movements. |
   | `DOLIBARR_DEFAULT_COMMERCIAL_ID` | Optional. Dolibarr user ID recorded as signing and follow-up representative on contracts created by `create_contract`. Defaults to the API user. |
   | `MCP_ALLOW_DELETES` | Optional. Set to `true` to enable guarded delete tools. Defaults to disabled. |
   | `MCP_HTTP_HOST` | Defaults to `0.0.0.0`. |
   | `MCP_HTTP_PORT` | Defaults to `3000`. |

4. Run locally:

   ```sh
   npm run dev
   ```

   Or with Docker:

   ```sh
   docker compose up
   ```

## Integration Tests

The integration tests run against a real Dolibarr REST API and create/delete real records.
Use a development Dolibarr instance, not production data.

Required environment:

| Variable | Description |
| --- | --- |
| `DOLIBARR_URL` | Full Dolibarr REST API base URL. |
| `DOLIBARR_API_KEY` | API token with thirdparty, proposal, and product/service permissions. |

`MCP_API_KEY` is not used by these tests; if it is missing, the test runner sets a local dummy
value so the shared config module can load.

Run:

```sh
npm run test:integration
```

The proposal test looks up the first available service through `/products?mode=2&limit=1`,
then creates a validated proposal with one catalog service line and one free-text line.

## Dolibarr Requirements

The Dolibarr instance must have the API REST module enabled.

The Dolibarr API token belongs to a normal Dolibarr user, so that user's permissions decide
what the MCP server can read or write. If a module is inactive or the user lacks rights,
Dolibarr often returns a generic 403 Forbidden response.

Important Products/Services note:

Dolibarr exposes products and services through the same REST endpoint:

```text
/products
```

The MCP tools hide that detail:

| Tool | Description |
| --- | --- |
| `search_products` | Searches only products. |
| `search_services` | Searches only services. |

However, even service searches use Dolibarr's `/products` API internally with `mode=2`.
That means the Products/Services module and API endpoint must be enabled, even if you only
use services and never create products.

For service search to work, confirm in Dolibarr:

- API REST module is enabled.
- Products/Services module is enabled.
- The API user has read permission for products/services.

## Implemented Tools

Read tools:

- `get_client_overview`
- `get_invoice_detail`
- `get_supplier_invoice_detail`
- `get_proposal_detail`
- `get_monthly_revenue`
- `get_outstanding_receivables`
- `search_across`
- `search_document_content`
- `search_products`
- `search_services`
- `search_thirdparties`
- `list_invoices`
- `list_proposals`
- `list_orders`
- `list_contracts`
- `list_payments`
- `list_products`
- `list_payment_modes`
- `list_bank_accounts`
- `list_contracts_by_expiry`
- `get_contract_detail`
- `list_interventions`
- `get_maintenance_overview`
- `list_projects`
- `get_project_detail`
- `get_pipeline_overview`
- `list_time_entries`

Write tools:

- `create_thirdparty`
- `update_thirdparty`
- `create_invoice`
- `update_invoice`
- `create_supplier_invoice`
- `update_supplier_invoice`
- `validate_invoice`
- `mark_invoice_paid`
- `create_proposal`
- `update_proposal`
- `validate_proposal`
- `set_proposal_status`
- `update_product`
- `update_service`
- `create_contract`
- `create_renewal_invoice`
- `create_intervention`
- `set_contract_status`
- `create_project`
- `update_project`
- `set_project_status`
- `create_task`
- `update_task`
- `log_time`

See `todo.md` for the current implementation and verification checklist.

### CRUD coverage

| Entity | Create | Read | Update | Lifecycle / status | Delete |
| --- | --- | --- | --- | --- | --- |
| Thirdparties | `create_thirdparty` | `search_thirdparties`, `get_client_overview` | `update_thirdparty` | — | guarded `delete_thirdparty` |
| Client invoices | `create_invoice` | `list_invoices`, `get_invoice_detail` | `update_invoice` (draft only) | `validate_invoice`, `set_invoice_status`, `mark_invoice_paid` | guarded `delete_invoice` |
| Supplier invoices | `create_supplier_invoice` | `get_supplier_invoice_detail` | `update_supplier_invoice` (draft only) | `set_supplier_invoice_status`, `mark_invoice_paid` | guarded `delete_supplier_invoice` |
| Proposals | `create_proposal` | `list_proposals`, `get_proposal_detail` | `update_proposal` (draft only) | `validate_proposal`, `set_proposal_status` | guarded `delete_proposal` |
| Products / services | — | `list_products`, `search_products`, `search_services` | `update_product`, `update_service` | — | — |
| Contracts | `create_contract` | `list_contracts`, `list_contracts_by_expiry`, `get_contract_detail`, `get_maintenance_overview` | — | `set_contract_status` | — |
| Interventions | `create_intervention` | `list_interventions` | — | — | — |
| Projects / leads | `create_project` | `list_projects`, `get_project_detail`, `get_pipeline_overview` | `update_project` | `set_project_status` | — |
| Tasks | `create_task` | `get_project_detail` | `update_task` | — | — |
| Time entries | `log_time` | `list_time_entries`, `get_project_detail` | — | — | — |

Guarded delete tools require `MCP_ALLOW_DELETES=true` and `confirm: true`.

### Browsing records and payments

All six list tools accept `limit` (1–100, default 50) and `offset` (default 0).
Responses include the named collection, `count`, `has_more`, and `next_offset`.
Lists use descending record ID order. Pagination reflects current data; concurrent
insertions or deletions can shift offsets between calls.

| Tool | Optional filters |
| --- | --- |
| `list_invoices` | `thirdparty_id`, `status` (draft/validated/paid/cancelled), `date_from`, `date_to` |
| `list_proposals` | `thirdparty_id`, `status` (draft/validated/sent/accepted/refused/billed/closed), `date_from`, `date_to` |
| `list_orders` | `thirdparty_id`, `status` (draft/validated/shipment_in_process/delivered/cancelled), `date_from`, `date_to` |
| `list_contracts` | `thirdparty_id`; includes contracts without an expiry date and current service summaries |
| `list_payments` | `thirdparty_id`, `date_from`, `date_to`, `max_invoices`, `invoice_offset` |
| `list_products` | `ref`, `label` (contained text, combined with AND), `type` (product/service); defaults to both types |

Dates must be valid `YYYY-MM-DD` values and both endpoints are inclusive. Document
lists filter the document date; payments filter the payment date. Proposal `sent`
is an alias for validated because Dolibarr has no separate sent status. `closed`
includes accepted, refused and billed. Invoice `cancelled` corresponds to Dolibarr's
abandoned status; summaries use the existing `abandoned` label.

`list_payments` returns customer invoice payment **allocations**: one shared payment
can appear for multiple invoices, with each row's allocated amount. Supplier payments,
credit notes, discounts and deposit applications are excluded. The bundled Dolibarr
API exposes payments per invoice, so the tool scans invoices of all dates (up to
`max_invoices`, default 1000, maximum 10000) with bounded concurrency, then sorts
allocations by payment date descending within that scan. A recent payment on an old
invoice can therefore be found. `scan.complete` is true only when the scan includes
all invoices from offset zero. If `scan.more_invoices_available` is true, resume at
`scan.next_invoice_offset`. First paginate allocations in the current scan using
`next_offset`; reset `offset` to zero when advancing `invoice_offset`. An empty payment
page with an incomplete invoice scan does not establish that no payments exist.

`search_document_content` accepts `thirdparty_id` and `thirdparty_name`. A name is
resolved before listing documents; ambiguous names return candidates and missing
names return a structured error. Supplying both filters requires them to identify
the same thirdparty. The customer filter applies **before** the recent-document
scan limit for every document type. The scan remains bounded, with the existing
per-type `more_documents_available` metadata indicating older documents may remain.

Example calls:

```json
{"name":"list_invoices","arguments":{"thirdparty_id":7,"status":"paid","limit":25}}
{"name":"search_document_content","arguments":{"query":"maintenance","thirdparty_name":"Example Company"}}
```

### Updating documents

`update_invoice`, `update_supplier_invoice`, and `update_proposal` change header fields and
lines of a **draft** document in one call:

- `update_lines` edits existing lines by `line_id` (from the detail tools). Fields left out
  keep their current value.
- `add_lines` appends lines in the same shape as the create tools' `lines`.
- `remove_line_ids` deletes lines.

All inputs are checked before the first write, so a rejected request leaves the document
unchanged. Non-draft documents are refused with `NOT_DRAFT`; reopen them with the matching
`set_*_status` tool (`status: "draft"`) first. Dolibarr's REST API itself accepts header
changes on validated documents, so this restriction is enforced by the MCP server.

Status changes are not updates: validation, acceptance/refusal, payments, and reopening stay
in their explicit lifecycle tools.

`update_proposal` keeps the validity period when only the date changes, so the end date
moves with it. Pass `valid_until` to set the end date explicitly.

`create_invoice` and `update_invoice` take an optional `due_date`, which must not be before
the invoice date. Without it, `create_invoice` lets Dolibarr derive the due date from the
payment terms. When `update_invoice` changes only the date, it recomputes the due date from
the payment terms, as the Dolibarr UI does. The REST API alone would keep the old due date.

### Updating products and services

`update_product` and `update_service` change the ref, label, description, selling price
(excl. tax), VAT rate, on sale / on purchase flags, and notes of a catalog item found by exact
ref or ID. Only the fields you pass change. The item type is never changed: using
`update_service` on a product (or the reverse) returns `CATALOG_TYPE_MISMATCH`, and a ref
that is already taken returns `DUPLICATE_REF`.

Dolibarr applies price and VAT changes through this API only in "one price per product" or
customer-price mode. In per-segment or per-quantity pricing it drops them silently, so the
tools re-read the item and return a `warnings` entry when the price or VAT rate did not change.
The API user needs create/modify rights on products/services.

### Maintenance contracts

The maintenance tools answer which contracts expire or have expired, whether a renewal invoice
exists, and which visits were carried out. They use only the REST API and delete nothing; the
write tools are plain create/status tools, so the MCP client's tool approval is the confirmation
step, as for the other `create_*` tools. All of them work on the Dolibarr instance configured in
`DOLIBARR_URL`.

Rules the tools derive (Dolibarr keeps none of them on the contract itself):

- **End date**: a contract has no end date of its own. It is the latest `date_end` over its
  lines. A line with status 4 (running) and an end date before today is expired.
- **Status** (`expired` | `expiring` | `running`): `expired` when the end date is before today,
  `expiring` within `days_ahead` days, `running` otherwise. `list_contracts_by_expiry` only
  lists contracts with at least one running line and an end date; drafts, fully closed
  contracts and contracts without any line end date have nothing to expire.
- **`renewal_invoiced`**: true when a linked invoice is dated more than 30 days after the
  contract start (`date_contrat`, else the earliest line start). Abandoned invoices do not
  count. Dolibarr's list endpoint carries no linked objects, so each listed contract is
  re-read through `GET /contracts/{id}`.
- **Yearly value excl. VAT**: the line totals of all lines that are not closed, scaled to 12
  months when a line covers another period.

`create_contract` creates the contract, adds the service lines, validates it and activates every
line, for `duration_months` from `start_date` (12 months from 2026-01-01 ends 2026-12-31).
Dolibarr requires a signing and follow-up representative, so it uses
`DOLIBARR_DEFAULT_COMMERCIAL_ID` or else the API user (`/users/info`); when neither is
available it returns a `VALIDATION_ERROR` that names the variable.

`create_renewal_invoice` bills the period after the contract's current end date, as long as the
contract term (or `period_months`), with the period in each line description and as the line's
service dates. The invoice is linked through `linked_objects: {"contrat": id}`, the only way
Dolibarr accepts; the tool re-reads the contract to confirm the link. It refuses with
`RENEWAL_ALREADY_INVOICED` when a renewal invoice is already linked, unless `allow_duplicate`
is set. It does not change the contract's own line dates, so the contract keeps showing as
expired or expiring until its lines are extended in Dolibarr.

`create_intervention` creates an intervention on the contract's client (`fk_project` 0,
`fk_contrat` set), adds one line with the date and duration, validates it and, unless
`close: false`, marks it done (status 3). `get_maintenance_overview` reports the latest done
intervention per contract and flags contracts with running services and no done intervention in
the last 12 months.

`set_contract_status` closes a contract (`closed`) or deactivates lines (`lines_deactivated`).
In Dolibarr both end up as closed service lines (status 5); nothing is deleted. Closing a draft
contract is refused, because Dolibarr would validate it as a side effect.

If a later step of a create tool fails, the record created so far is kept and the error carries
its ID (`contract_id`, `invoice_id`, `intervention_id`) plus the failed step.

### Projects, leads, tasks and time

Dolibarr has no separate lead object: a lead is a project with "follow an opportunity"
(`usage_opportunity`) set, plus a stage, an amount and a probability. The project tools
handle both kinds of project, and every project belongs to an existing thirdparty.

- **Projects are addressed** by Dolibarr ID, exact ref (`PJ2511-0004`) or title. A title
  matches on a substring; one exact title wins over partial matches, and several matches return
  `PROJECT_AMBIGUOUS` with candidates.
- **Lead stages** are the default Dolibarr dictionary (`llx_c_lead_status`), which the REST API
  does not expose: `prospection` (0%), `qualification` (20%), `proposal` (40%),
  `negotiation` (60%), `pending` (50%, inactive by default), `won` (100%), `lost` (0%).
  Setting a stage without a probability uses the stage's percentage. Weighted amount =
  amount × probability. If the dictionary has been changed in Dolibarr, the IDs in
  `src/dolibarr/projects/projectRules.ts` must be changed to match.
- **Pipeline**: `get_pipeline_overview` counts leads that are not closed and not won or lost.
  It totals them per stage and lists leads whose end date (expected close) has passed.
  Marking a lead won or lost does not close the project and creates nothing else; use
  `set_project_status` for that.
- **`create_project`** creates the project with ref `auto` and makes the API user project
  leader, as the Dolibarr UI does (the REST API does not). The API user is read from
  `/users/info`, falling back to `DOLIBARR_DEFAULT_COMMERCIAL_ID`. If that step fails, the
  response carries a warning instead of failing, because a project visible only to
  assigned contacts would be hidden from users who cannot see all projects. By default the
  project is then validated (open).
- **`set_project_status`**: `open` validates a draft or reopens a closed project
  (`POST /projects/{id}/validate`, the same call the UI uses to reopen). Dolibarr has no close
  endpoint, so `closed` sets `status: 2`, `date_close` and `fk_user_close` through
  `PUT /projects/{id}`. That skips the `PROJECT_CLOSE` trigger.
- **Tasks** are created through `POST /tasks`; Dolibarr's `POST /projects/{id}/tasks` route is
  commented out. A task is billable when its project bills time. `update_task` with
  `progress: 100` marks it done.
- **`log_time`** finds the task by ref or ID, or by project plus task label. With only a
  project it uses that project's single task, and returns `TASK_AMBIGUOUS` with the task list
  when there are several. The entry starts at `start_time` (default 09:00) in
  `DOLIBARR_TIMEZONE` and is sent to Dolibarr in GMT. Dolibarr returns no ID for the new
  entry, so the response shows the task's spent hours before and after.
- **`list_time_entries`** reads `GET /projects/alltimespent`. That endpoint's
  `thirdparty_ids` parameter filters on a column tasks do not have, so the client filter goes
  through `sqlfilters` on the project (`p.fk_soc`). It scans at most 1000 entries and warns
  when it hits that limit.
- **`get_project_detail`** lists the proposals, orders, client invoices and supplier invoices
  that have `fk_projet` set to the project. Its totals count signed (accepted or billed)
  proposals, and validated or paid invoices. A module the API user cannot read contributes
  nothing instead of failing the call.

### Marking invoices paid

`mark_invoice_paid` handles both client and supplier invoices. The invoice must already be
validated. With no `payment` input it only marks the invoice paid. With
`payment.mode: "create"`, it creates a payment for the remaining balance and asks Dolibarr to
close the invoice in the same transaction. `payment_mode` accepts an ID, exact code, or unique
label; `bank_account` accepts an ID, exact ref, or unique label/bank name. Use
`list_payment_modes` and `list_bank_accounts` to inspect the available choices. Numeric
`payment_mode_id` and `account_id` remain supported for compatibility.

Before creating the payment, the tool resolves both selections against Dolibarr. Its response
includes the resolved payment mode and bank account names, refs, and masked account identifier,
so callers can confirm where the payment was recorded.

Dolibarr's invoice REST APIs can list payments already allocated to an invoice, but cannot add
a new allocation for a previously created payment. `payment.mode: "existing"` therefore
verifies that the supplied payment reference or number is already linked before marking the
invoice paid. Link an unallocated existing payment in the Dolibarr UI first.

## Project Structure

The MCP tool files are intentionally thin: they define the Zod input schema, call a domain
service or Dolibarr API module, and format the MCP response.

Tools are grouped by business domain under `src/tools/`:

- `catalog`
- `invoices`
- `payments`
- `projects`
- `proposals`
- `search`
- `thirdparties`

Shared document creation logic lives in:

```text
src/dolibarr/documents/documentCreationService.ts
```

That service handles the common workflow for invoices, supplier invoices, and proposals:
resolve the thirdparty, resolve catalog/free-text lines, create the document, add lines,
and optionally validate it.

Draft document updates use the matching `src/dolibarr/documents/documentUpdateService.ts`,
which enforces the draft-only rule, validates line IDs and new lines up front, and merges
line edits with the existing line before sending them to Dolibarr.

## Errors

Tool errors are returned as structured JSON. For example, when Dolibarr returns a 403 for a
known module endpoint, the server returns:

```json
{
  "error": "DOLIBARR_MODULE_UNAVAILABLE",
  "message": "Dolibarr refused access to the ... API. The module may be inactive or the API user may be missing permissions.",
  "action": "..."
}
```

Because Dolibarr uses the same 403 shape for inactive modules and missing permissions, check
both when debugging access failures.

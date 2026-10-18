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
- `list_payment_modes`
- `list_bank_accounts`

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

See `todo.md` for the current implementation and verification checklist.

### CRUD coverage

| Entity | Create | Read | Update | Lifecycle / status | Delete |
| --- | --- | --- | --- | --- | --- |
| Thirdparties | `create_thirdparty` | `search_thirdparties`, `get_client_overview` | `update_thirdparty` | — | guarded `delete_thirdparty` |
| Client invoices | `create_invoice` | `get_invoice_detail` | `update_invoice` (draft only) | `validate_invoice`, `set_invoice_status`, `mark_invoice_paid` | guarded `delete_invoice` |
| Supplier invoices | `create_supplier_invoice` | `get_supplier_invoice_detail` | `update_supplier_invoice` (draft only) | `set_supplier_invoice_status`, `mark_invoice_paid` | guarded `delete_supplier_invoice` |
| Proposals | `create_proposal` | `get_proposal_detail` | `update_proposal` (draft only) | `validate_proposal`, `set_proposal_status` | guarded `delete_proposal` |
| Products / services | — | `search_products`, `search_services` | `update_product`, `update_service` | — | — |

Guarded delete tools require `MCP_ALLOW_DELETES=true` and `confirm: true`.

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

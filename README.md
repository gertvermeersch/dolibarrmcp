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
   | `MCP_API_KEY` | Secret expected from MCP clients in the `X-API-Key` header. |
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
- `create_supplier_invoice`
- `validate_invoice`
- `mark_invoice_paid`
- `create_proposal`
- `validate_proposal`
- `set_proposal_status`

See `todo.md` for the current implementation and verification checklist.

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

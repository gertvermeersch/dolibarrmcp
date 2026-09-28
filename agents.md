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
├── index.ts          Entry point — HTTP server, X-API-Key auth, MCP wiring
├── server.ts         Registers all tools with the MCP server instance
├── config.ts         Reads and validates env vars; throws on startup if any are missing
├── types/
│   ├── dolibarr.ts   TypeScript types for raw Dolibarr API responses
│   └── tools.ts      Shared types: McpError, error codes, LineItemInput, etc.
├── dolibarr/
│   ├── client.ts     Fetch wrapper — sets DOLAPIKEY header, normalises errors
│   ├── documents/    Domain services for shared document workflows
│   ├── thirdparties.ts
│   ├── invoices.ts
│   ├── supplierInvoices.ts
│   ├── proposals.ts
│   └── products.ts
├── resolvers/
│   ├── thirdparty.ts Fuzzy name → ID resolution with structured errors
│   └── product.ts    Catalog match → line item, with free-text fallback
└── tools/
    ├── catalog/      Product and service catalog tools
    ├── invoices/     Client/supplier invoice and receivables tools
    ├── payments/     Payment-mode and bank-account discovery tools
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
MCP_API_KEY        Secret used to authenticate incoming MCP requests (X-API-Key header)
DOLIBARR_URL       Full base URL to Dolibarr REST API
DOLIBARR_API_KEY   Dolibarr personal API token
DOLIBARR_DEBUG     Optional: true/1/yes/on logs Dolibarr requests and responses
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
- `get_client_overview` (read)
- `get_invoice_detail` (read)
- `get_monthly_revenue` (read)
- `get_outstanding_receivables` (read)
- `search_across` (read)
- `search_document_content` (read)
- `search_products` (read)
- `search_services` (read)
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
- `list_payment_modes` and `list_bank_accounts` (read; payment option discovery)
- `resolveThirdparty` resolver
- `resolveLine` resolver
- `dolibarr/client.ts` — fetch wrapper + error normalisation
- All `dolibarr/*.ts` API modules

See `todo.md` for detailed task breakdowns and remaining verification work.

# TODO

Generated from a project scan on 2026-05-20.

## Read tools still unfinished

- [x] Implement `get_client_overview` in `src/tools/thirdparties/getClientOverview.ts`.
  - [x] Resolve the client by ID or name with `resolveThirdparty`.
  - [x] Fetch thirdparty details, contacts, open invoices, and last order information.
  - [x] Return company info, contacts, open invoice count, unpaid balance, and last order date.
- [x] Implement `get_outstanding_receivables` in `src/tools/invoices/getOutstandingReceivables.ts`.
  - [x] Fetch unpaid validated invoices.
  - [x] Resolve thirdparty names for unique `socid` values.
  - [x] Group invoices by client and bucket overdue balances into `0-30`, `31-60`, `61-90`, and `90+` days.
- [x] Implement `get_monthly_revenue` in `src/tools/invoices/getMonthlyRevenue.ts`.
  - [x] Accept `year` and `month`.
  - [x] Build a Dolibarr date range for the month.
  - [x] Fetch finalized invoices and return monthly revenue totals.
- [x] Implement `search_across` in `src/tools/search/searchAcross.ts`.
  - [x] Search thirdparties, invoices, and orders in parallel.
  - [x] Return lean grouped results with IDs, refs/names, dates, and statuses.

## Search improvements

- [x] Develop content search across document lines.
  - [x] Search for text contained in proposal, order, client invoice, and supplier invoice lines.
  - [x] Include matched document refs, thirdparty names, line IDs, product/service refs where available, and matched line descriptions.
  - [x] Expose a separate `search_document_content` tool so bounded line scanning stays distinct from lean `search_across` results.
  - [x] Dolibarr document-list `sqlfilters` target header table aliases rather than joined line descriptions; use a safe bounded recent-document fetch-and-filter with scan/truncation metadata.

## Existing implementation to verify

- [x] Verify `get_invoice_detail` against the real Dolibarr API.
  - [x] Confirm `/invoices/{id}?includeLines=1` returns lines in the expected shape.
  - [x] Confirm invoice lookup by `ref` works with the current SQL filter.
  - [x] Confirm payment fields such as `totalpaid`, `total_paye`, `remaintopay`, and `remaining_to_pay` are correct for this Dolibarr version.
- [x] Update stale docs after verification.
  - [x] `README.md` lists verified read tools, including `get_invoice_detail`.
  - [x] `agents.md` lists verified read tools as implemented.
  - [x] Documentation should refer to `todo.md` and domain folders under `src/tools/`.
- [x] Tighten `set_proposal_status`.
  - [x] Only ignore the validate step when the proposal is already validated.
  - [x] Do not swallow unrelated validation failures before closing the proposal.
- [x] Confirm proposal close API shape for `POST /proposals/{id}/close`.
  - [x] Verified with a disposable proposal on 2026-07-02: body `{ status: 3, note_private, notrigger }` closes as refused with `statut = 3`.
  - [x] Current code maps accepted/refused to numeric statuses `2`/`3`.
- [x] Confirm supplier invoice endpoint paths.
  - [x] Verified on 2026-07-02: `/supplierinvoices?limit=1` works.
  - [x] Verified on 2026-07-02: `/fourn/invoices?limit=1` and `/fourn/factures?limit=1` return `501 API not found`.
- [x] Confirm proposal line endpoint path.
  - [x] Current code uses `/proposals/{id}/line`.
  - [x] Verified on 2026-07-02: this Dolibarr version supports both `/proposals/{id}/line` and `/proposals/{id}/lines` for adding lines.

## Output normalization issues from initial testing

- [x] Normalize monetary values across all MCP tool outputs.
  - [x] Fix `get_outstanding_receivables` float precision noise; `total_outstanding` was observed as `3338.7900000000004`.
  - [x] Round displayed monetary sums to 2 decimal places at the response boundary.
  - [x] Use numeric money values across tool payloads; avoid mixing numbers like `remaining_to_pay: 1887.6` with 8-decimal strings like `total_including_tax: "1887.60000000"` in the same payload.
- [x] Normalize dates across all MCP tool outputs.
  - [x] Keep period-style fields such as `period` and `as_of` as ISO 8601 strings.
  - [x] Convert per-document fields such as invoice `date`, `due_date`, proposal dates, and order dates from raw Unix epochs to ISO strings.
  - [x] Drop raw epoch fields from tool payloads unless a tool has a specific machine-facing need for them.
- [x] Audit all tools for unresolved Dolibarr foreign keys.
  - [x] Fix `get_client_overview` leaking `country_id: "2"`; resolve countries to a stable code/name such as `BE` / `Belgium`.
  - [x] Check other outputs for raw IDs where a user-facing label, code, or resolved object is expected.
- [x] Normalize identifier types across tool outputs.
  - [x] Avoid ID drift such as `120` as a number in one tool and `"120"` as a string in another.
  - [x] Use numeric Dolibarr IDs consistently in MCP responses.
- [x] Add focused tests or snapshots for output normalization.
  - [x] Cover monetary rounding/formatting.
  - [x] Cover ISO date conversion.
  - [x] Cover FK resolution for client overview country fields.

## Dolibarr API helpers to add

- [x] Add delete helpers for client invoices and supplier invoices so integration tests can clean up created records.
- [x] Add get/list helpers for supplier invoices to support verification after creation.
- [x] Add a contacts helper for `GET /thirdparties/{id}/contacts`.
- [x] Add an orders helper if `get_client_overview` or `search_across` needs last order/search results.
- [x] Add shared status-label helpers for invoices and proposals instead of duplicating status maps inside tools.
- [x] Add request timeout handling in `src/dolibarr/client.ts`.
- [x] Add basic request/tool logging for startup, tool calls, and Dolibarr API errors.

## CRUD coverage audit and plan

Current MCP tool coverage, checked against `src/server.ts` on 2026-07-04:

- [x] Thirdparties: create via `create_thirdparty`, read via `search_thirdparties` and `get_client_overview`, update via `update_thirdparty`; delete exists only as the internal `deleteThirdparty` cleanup helper.
- [x] Client invoices: create via `create_invoice`, read via `get_invoice_detail`, `get_monthly_revenue`, and `get_outstanding_receivables`, lifecycle validation via `validate_invoice`; update is missing, delete exists only as the internal `deleteInvoice` cleanup helper.
- [x] Supplier invoices: create via `create_supplier_invoice`, read via `get_supplier_invoice_detail`, lifecycle validation through the create tool; update is missing, delete exists only as the internal `deleteSupplierInvoice` cleanup helper.
- [x] Proposals: create via `create_proposal`, read via `get_proposal_detail`, lifecycle changes via `validate_proposal` and `set_proposal_status`; update is missing, delete exists only as the internal `deleteProposal` cleanup helper.
- [x] Catalog products/services: read via `search_products` and `search_services`; create, update, and delete are missing.
- [x] Cross-domain search: `search_across` is intentionally read-only and does not need create/update/delete variants.

Implementation plan:

- [ ] Verify Dolibarr update endpoint shapes against the real development instance.
  - [ ] Client invoice header update: confirm `PUT /invoices/{id}` fields and draft-only behavior.
  - [ ] Client invoice line update: confirm `/invoices/{id}/lines/{lineid}` or equivalent endpoint support.
  - [ ] Supplier invoice header update: confirm `PUT /supplierinvoices/{id}` fields and draft-only behavior.
  - [ ] Supplier invoice line update: confirm supported line endpoint paths and required field names.
  - [ ] Proposal header update: confirm `PUT /proposals/{id}` fields and draft/open status behavior.
  - [ ] Proposal line update: confirm supported line endpoint paths and required field names.
  - [ ] Catalog product/service update: confirm `PUT /products/{id}` payload requirements and service/product mode flags if catalog mutation is in scope.
- [ ] Add missing Dolibarr API helpers after endpoint verification.
  - [ ] Add `updateInvoice` and `updateInvoiceLine`.
  - [ ] Add `updateSupplierInvoice` and `updateSupplierInvoiceLine`.
  - [ ] Add `updateProposal` and `updateProposalLine`.
  - [ ] Add catalog update helpers for products and services if catalog mutation is in scope.
- [ ] Add MCP update tools.
  - [ ] `update_invoice` for draft client invoice header fields and line edits.
  - [ ] `update_supplier_invoice` for draft supplier invoice header fields and line edits.
  - [ ] `update_proposal` for proposal header fields and line edits while Dolibarr allows mutation.
  - [ ] `update_product` and `update_service` if catalog mutation is in scope.
  - [ ] Keep lifecycle operations separate from update tools: validation, proposal acceptance/refusal, payments, and cancellation should remain explicit tools.
- [ ] Expand integration tests for update coverage.
  - [ ] Thirdparty test should exercise `create_thirdparty`, `search_thirdparties`/`get_client_overview`, `update_thirdparty`, and cleanup delete.
  - [ ] Client invoice lifecycle should include draft update before validation, fetch after update, validation, and cleanup delete.
  - [ ] Supplier invoice lifecycle should include draft update before validation, fetch after update, validation, and cleanup delete.
  - [ ] Proposal lifecycle should include draft update before validation, fetch after update, validation/status change, and cleanup delete.
  - [ ] Catalog tests should create or reuse a disposable product/service, update it, search/read it back, and clean it up if catalog mutation is implemented.
- [ ] Update documentation once update support is implemented.
  - [ ] Add a CRUD coverage table to `README.md`.
  - [ ] Document which tools are lifecycle/status tools rather than plain updates.
  - [ ] Document draft-only restrictions for document update tools.
- [ ] Consider catalog create tools after update support is stable.
  - [ ] `create_product` and `create_service`.

## Invoice payments

- [x] Add `mark_invoice_paid` for validated client and supplier invoices.
- [x] Support status-only closing through each invoice API's `/settopaid` endpoint.
- [x] Optionally create a full remaining-balance payment through `/payments` and close atomically.
- [x] Verify an already-linked payment by reference or payment number before closing.
- [x] Document that this Dolibarr REST version cannot newly allocate an existing payment to an invoice.
- [x] Add `list_payment_modes` and `list_bank_accounts` so callers do not guess numeric IDs.
- [x] Resolve payment modes and bank accounts by ID, code/ref, or unique human-readable name.
- [x] Echo resolved payment and account identities after payment creation.
- [ ] Verify payment creation against a disposable invoice on the real development instance, including cleanup of the generated payment and bank entry.
- [ ] Decide the public MCP delete policy before exposing destructive tools.
  - [ ] Prefer guarded deletes such as `delete_invoice`, `delete_supplier_invoice`, `delete_proposal`, and `delete_thirdparty` with an explicit `confirm: true` input.
  - [ ] Refuse deletion of validated/posted business documents unless Dolibarr supports the operation safely and the tool explains the restriction in its error payload.
  - [ ] Keep cleanup-only helpers internal if public delete tools are considered too risky.
- [ ] Add delete API helpers and MCP tools only if the delete policy approves them.
  - [ ] Add `deleteInvoiceLine`, `deleteSupplierInvoiceLine`, and `deleteProposalLine` if line deletion is safe and useful.
  - [ ] Add `delete_product` and `delete_service` with explicit confirmation if catalog deletes are in scope.
  - [ ] Public document/thirdparty delete tools only after the delete policy is settled.

## Integration tests for the real Dolibarr API

Use `test/integration/dolibarr-api.test.ts` as the reference style: skip when `DOLIBARR_URL` or `DOLIBARR_API_KEY` is missing, create disposable records, verify through the API, and clean up in `finally`.

- [x] Add a client invoice lifecycle integration test.
  - [x] Create a disposable client thirdparty.
  - [x] Find an active service/product line.
  - [x] Create a client invoice with one catalog line and one free-text line.
  - [x] Validate the invoice.
  - [x] Fetch it with `getInvoice`.
  - [x] Exercise `get_invoice_detail` by ID and by ref.
  - [x] Delete the invoice and thirdparty during cleanup.
- [x] Add a supplier invoice lifecycle integration test.
  - [x] Create a disposable supplier thirdparty.
  - [x] Create a supplier invoice with a catalog/free-text line where supported.
  - [x] Validate the supplier invoice.
  - [x] Fetch it back through a supplier invoice helper.
  - [x] Delete the supplier invoice and supplier during cleanup.
- [x] Add a proposal status integration test.
  - [x] Create a disposable proposal.
  - [x] Validate it.
  - [x] Mark it accepted or refused through `closeProposal` or the MCP tool path.
  - [x] Verify the resulting Dolibarr status.
  - [x] Clean up the proposal and thirdparty.
- [x] Add integration coverage for catalog and thirdparty searches.
  - [x] `searchProducts`
  - [x] `searchServices`
  - [x] `searchThirdparties`
  - [x] MCP tool formatting for `search_products`, `search_services`, and `search_thirdparties`
- [x] Add integration coverage for the remaining read tools once implemented.
  - [x] `get_client_overview`
  - [x] `get_outstanding_receivables`
  - [x] `get_monthly_revenue`
  - [x] `search_across`
- [x] Keep integration tests safe for local Dolibarr data.
  - [x] Prefix all created records with `MCP Integration`.
  - [x] Use unique names/refs.
  - [x] Avoid running against production.
  - [x] Surface cleanup errors with `AggregateError`, as the existing test does.

## Refactoring backlog

Keep these scoped and behavior-preserving. The current layout is good enough; the goal is to remove repeated workflow code before adding larger decision-support tools.

- [x] Declare `zod` as a direct dependency in `package.json`.
  - [x] 24 source files `import { z } from "zod"`, but it is only resolved transitively via `@modelcontextprotocol/sdk`.
  - [x] Pin a range matching what the SDK currently resolves, such as `"zod": "^3.25 || ^4.0"`.
  - [x] This is a latent break, not a cleanup: an SDK bump that drops or major-bumps zod would break every tool with no local code change.
- [x] Add a shared MCP tool wrapper such as `registerJsonTool` (`src/tools/shared/registerJsonTool.ts`).
  - [x] Centralize `server.registerTool`, `try`/`catch`, `jsonContent(toApiError(err))`, and optional pretty JSON formatting (`pretty: true`).
  - [x] Migrate simple search/read tools first to prove the shape (22 of 24 tools migrated).
  - [x] Preserve per-tool `toApiError` context via `errorContext`, such as supplier invoice duplicate-ref handling.
  - [x] `validate_invoice` and `validate_proposal` stay on manual `registerTool`: they merge the entity id into the idempotent-success error payload, which the wrapper does not model.
- [x] Generalize document creation tool registration.
  - [x] Keep `DocumentCreationService` as the workflow engine.
  - [x] Extract the repeated create-tool success mapping for invoices, supplier invoices, and proposals (`src/tools/shared/documentCreationResponse.ts`).
  - [x] Keep entity-specific input names and response field names explicit at the edge.
- [x] Extract a shared "resolve by numeric ID or exact ref" helper (`src/tools/shared/resolveByIdOrRef.ts`).
  - [x] Cover client invoices, supplier invoices, and proposals.
  - [x] Support entity-specific reference filters, including supplier invoice `ref_supplier`.
  - [x] Return `undefined` on Dolibarr 404 while still throwing unexpected API errors.
- [x] Consolidate guarded document delete flows (`runGuardedDelete` in `src/tools/shared/deleteGuards.ts`).
  - [x] Share delete-enabled checks, dry-run response construction, draft/reopen guards, delete call, and success response.
  - [x] Keep thirdparty delete separate because it has linked-document prechecks.
  - [x] Keep reopen options entity-specific, especially customer invoice `warehouse_id`.
- [x] Split Dolibarr error mapping out of `src/dolibarr/client.ts`.
  - [x] Keep HTTP request mechanics, timeout handling, and request/response logging in `client.ts`.
  - [x] Move module hints, Dolibarr error classification, and `toApiError` mapping into a dedicated error module (`src/dolibarr/errors.ts`; `DolibarrApiError` moved there too since the mapping owns it).
  - [x] Keep existing unit tests around the public error-mapping behavior (renamed `test/unit/client.test.ts` → `errors.test.ts`).
- [x] Centralize duplicate thirdparty type normalization.
  - [x] Move client/supplier/both/other logic into one domain helper (`src/dolibarr/thirdpartyType.ts`, pure and free of `client.js`).
  - [x] Reuse it from resolvers and serializers (`thirdparties.ts` re-exports it for existing importers).
- [ ] Add a reusable pagination helper for Dolibarr list endpoints.
  - [ ] Replace the page loops in revenue and receivables tools once the helper exists.
  - [ ] Reuse it for upcoming analytics and decision-support tools.
- [ ] Add focused unit tests as refactors land.
  - [ ] Cover the MCP wrapper's error path.
  - [x] Cover ID/ref resolution behavior (`test/unit/resolveByIdOrRef.test.ts`).
  - [x] Cover guarded delete helper behavior without calling the real API (`test/unit/runGuardedDelete.test.ts`).

## Test and quality workflow

- [ ] Keep `npm run test:integration` as the real-API test entry point.
- [ ] Add a fast unit test script for pure helpers and resolvers.
- [ ] Add test coverage for `dolibarr/sqlFilters.ts`.
- [ ] Add tests for `DocumentCreationService` validation behavior without calling the real API.
- [ ] Add tests for `toApiError` module-permission hints.
- [ ] Add CI notes or docs explaining that integration tests require a development Dolibarr instance.
- [ ] Run `npx tsc --noEmit` before merging changes.

## Documentation cleanup

- [ ] Consolidate `TODO.md` and `todo.md` once the team chooses a canonical filename.
- [ ] Update `README.md` implemented-tool lists after the read tools are completed.
- [ ] Document the required Dolibarr modules and permissions per tool.
- [ ] Document the expected cleanup behavior for integration tests.

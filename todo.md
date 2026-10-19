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

- [x] Verify Dolibarr update endpoint shapes against the real development instance (Dolibarr 24.0.0, 2026-09-28).
  - [x] Client invoice header update: `PUT /invoices/{id}` sets any posted field (`date`, `ref_client`, `note_public`, `note_private`, `cond_reglement_id` recomputes the due date). It is **not** draft-only: it also changes validated invoices, so the MCP tool enforces draft-only.
  - [x] Client invoice line update: `PUT /invoices/{id}/lines/{lineid}` works on drafts and returns 304 on validated invoices. Fields missing from the body are reset (a `{qty}`-only body zeroed price, VAT, discount, description, and product type), so updates resend the full merged line. `DELETE /invoices/{id}/lines/{lineid}` works.
  - [x] Supplier invoice header update: `PUT /supplierinvoices/{id}` sets `date`, `ref_supplier`, `label`, and notes. Not draft-only. `cond_reglement_id` does not recompute `date_echeance`, so payment terms are not exposed yet.
  - [x] Supplier invoice line update: `PUT /supplierinvoices/{id}/lines/{lineid}` uses `description`/`pu_ht`, resets missing fields like the client invoice endpoint, and even succeeds on **validated** supplier invoices.
  - [x] Proposal header update: `PUT /proposals/{id}` is not draft-only. `Propal::update()` recomputes `fin_validite = date + duree_validite`, and fetched proposals carry the `PROPALE_VALIDITY_DURATION` default (15) rather than their real duration, so any header PUT without `duree_validite` silently moves the end date.
  - [x] Proposal line update: `PUT /proposals/{id}/lines/{lineid}` merges missing fields with the current line. On a validated proposal it returns `200 false` without changing anything.
  - [x] Catalog product/service update: `PUT /products/{id}` fetches the item and only overwrites posted fields (a label-only PUT keeps price and VAT). Price/VAT changes apply only with `PRODUCT_PRICE_UNIQ` or `PRODUIT_CUSTOMER_PRICES`; the API user cannot read those settings (admin only). A posted `type` silently converts a service into a product. A duplicate ref returns a generic 500 listing `ErrorProductAlreadyExists`; a negative price returns an empty 500.
- [x] Add missing Dolibarr API helpers after endpoint verification.
  - [x] Add `updateInvoice`, `updateInvoiceLine`, and `deleteInvoiceLine`.
  - [x] Add `updateSupplierInvoice`, `updateSupplierInvoiceLine`, and `deleteSupplierInvoiceLine`.
  - [x] Add `updateProposal` (always sends `duree_validite`), `updateProposalLine`, and `deleteProposalLine`.
  - [x] Add `mergeLineUpdate` (`src/dolibarr/documents/lineUpdates.ts`) to build full line bodies from the current line plus requested changes.
  - [x] Add catalog helpers `getProduct`, `listProducts`, and `updateProduct`.
- [x] Add MCP update tools on a shared `DocumentUpdateService` (`src/dolibarr/documents/documentUpdateService.ts`).
  - [x] `update_invoice` for draft client invoice header fields (`date`, `customer_ref`, notes) and line edits.
  - [x] `update_supplier_invoice` for draft supplier invoice header fields (`date`, `supplier_invoice_ref`, `label`, notes) and line edits.
  - [x] `update_proposal` for draft proposal header fields (`date`, `valid_until`, `customer_ref`, notes) and line edits. Changing only `date` keeps the validity period.
  - [x] `due_date` on `create_invoice` (posted as `date_lim_reglement`, which the API forces over the payment terms) and `update_invoice`. A date-only PUT keeps the old due date, so `updateInvoice` resends `cond_reglement_id` after `date` to recompute it like the UI does (verified with 14-day terms on Dolibarr 24.0.0).
  - [x] Line edits: `update_lines` (partial, by `line_id`), `add_lines` (same shape as create), `remove_line_ids`. All inputs are validated before the first write.
  - [x] Non-draft documents are refused with `NOT_DRAFT` and point at the matching `set_*_status` tool.
  - [x] `update_product` and `update_service` (`src/tools/catalog/catalogUpdate.ts`): ref, label, description, price, VAT rate, on sale / on purchase, notes. Type mismatches are refused with `CATALOG_TYPE_MISMATCH`, duplicate refs map to `DUPLICATE_REF`, and ignored price/VAT changes are reported as `warnings`.
  - [x] Keep lifecycle operations separate from update tools: validation, proposal acceptance/refusal, payments, and cancellation remain explicit tools.
- [x] Expand integration tests for update coverage.
  - [ ] Thirdparty test should exercise `create_thirdparty`, `search_thirdparties`/`get_client_overview`, `update_thirdparty`, and cleanup delete.
  - [x] Client invoice: draft update (header + qty-only line edit + remove + add), fetch after update, validation, `NOT_DRAFT` refusal, cleanup delete.
  - [x] Supplier invoice: same flow, plus `ref_supplier`/`label` changes.
  - [x] Proposal: same flow, plus validity date kept on notes-only and date-only updates, explicit `valid_until`, and rejection of an end date before the proposal date.
  - [x] `callJsonTool` now parses args through the tool's input schema so Zod defaults apply as they do in the MCP server.
  - [x] Catalog test creates a disposable service and product, updates them through the tools, reads the service back via `search_services`, checks `DUPLICATE_REF` and `CATALOG_TYPE_MISMATCH`, and deletes both.
- [x] Update documentation once update support is implemented.
  - [x] Add a CRUD coverage table to `README.md`.
  - [x] Document which tools are lifecycle/status tools rather than plain updates.
  - [x] Document draft-only restrictions for document update tools.
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
  - [x] `listAllPages` exists in `src/dolibarr/pagination.ts` and is used by the contract and intervention list helpers.
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

## Maintenance contracts and interventions

Implemented from the maintenance requirements (tools: `list_contracts_by_expiry`, `get_contract_detail`, `list_interventions`, `get_maintenance_overview`, `create_contract`, `create_renewal_invoice`, `create_intervention`, `set_contract_status`; `search_across` now includes contracts and interventions).

- [x] Unit tests for the rules, services and tool output (`test/unit/contractRules.test.ts`, `maintenanceServices.test.ts`, `maintenanceTools.test.ts`).
- [x] Integration test `runs the maintenance contract lifecycle ...` in `test/integration/dolibarr-api.test.ts`.
- [x] Run the integration test against a test Dolibarr (2026-10-19, Dolibarr 24 test instance; passes with and without `DOLIBARR_DEFAULT_COMMERCIAL_ID`). Verified:
  - [x] `GET /contracts/{id}` returns the renewal invoice under `linkedObjectsIds.facture`.
  - [x] `fk_contrat` filters in `GET /interventions?sqlfilters=(t.fk_contrat:=:id)` and interventions get dated by their line date.
  - [x] Invoice lines accept `date_start`/`date_end` on `POST /invoices/{id}/lines`.
  - [x] `/users/info` works for the API user once it has user read rights; before that `create_contract` needs `DOLIBARR_DEFAULT_COMMERCIAL_ID`.
  - [x] The integration test's raw-API cleanup deletes the invoice, closed intervention, validated contract and thirdparty.
  - Note: the API user needs create rights on contracts and interventions; without them Dolibarr returns 403 and the interventions API makes `get_contract_detail` / `get_maintenance_overview` report `interventions_available: false`.
- [ ] No tool extends a contract's line dates after a renewal, so a renewed contract keeps showing as expired/expiring (only `renewal_invoiced` changes). Decide whether a `renew_contract` tool is wanted.

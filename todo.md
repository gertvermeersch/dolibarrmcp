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

## Dolibarr API helpers to add

- [ ] Add delete helpers for client invoices and supplier invoices so integration tests can clean up created records.
- [x] Add get/list helpers for supplier invoices to support verification after creation.
- [x] Add a contacts helper for `GET /thirdparties/{id}/contacts`.
- [x] Add an orders helper if `get_client_overview` or `search_across` needs last order/search results.
- [ ] Add shared status-label helpers for invoices and proposals instead of duplicating status maps inside tools.
- [ ] Add request timeout handling in `src/dolibarr/client.ts`.
- [ ] Add basic request/tool logging for startup, tool calls, and Dolibarr API errors.

## Integration tests for the real Dolibarr API

Use `test/integration/dolibarr-api.test.ts` as the reference style: skip when `DOLIBARR_URL` or `DOLIBARR_API_KEY` is missing, create disposable records, verify through the API, and clean up in `finally`.

- [ ] Add a client invoice lifecycle integration test.
  - [ ] Create a disposable client thirdparty.
  - [ ] Find an active service/product line.
  - [ ] Create a client invoice with one catalog line and one free-text line.
  - [ ] Validate the invoice.
  - [ ] Fetch it with `getInvoice`.
  - [ ] Exercise `get_invoice_detail` by ID and by ref.
  - [ ] Delete the invoice and thirdparty during cleanup.
- [ ] Add a supplier invoice lifecycle integration test.
  - [ ] Create a disposable supplier thirdparty.
  - [ ] Create a supplier invoice with a catalog/free-text line where supported.
  - [ ] Validate the supplier invoice.
  - [ ] Fetch it back through a supplier invoice helper.
  - [ ] Delete the supplier invoice and supplier during cleanup.
- [ ] Add a proposal status integration test.
  - [ ] Create a disposable proposal.
  - [ ] Validate it.
  - [ ] Mark it accepted or refused through `closeProposal` or the MCP tool path.
  - [ ] Verify the resulting Dolibarr status.
  - [ ] Clean up the proposal and thirdparty.
- [ ] Add integration coverage for catalog and thirdparty searches.
  - [ ] `searchProducts`
  - [ ] `searchServices`
  - [ ] `searchThirdparties`
  - [ ] MCP tool formatting for `search_products`, `search_services`, and `search_thirdparties`
- [ ] Add integration coverage for the remaining read tools once implemented.
  - [ ] `get_client_overview`
  - [ ] `get_outstanding_receivables`
  - [ ] `get_monthly_revenue`
  - [ ] `search_across`
- [ ] Keep integration tests safe for local Dolibarr data.
  - [ ] Prefix all created records with `MCP Integration`.
  - [ ] Use unique names/refs.
  - [ ] Avoid running against production.
  - [ ] Surface cleanup errors with `AggregateError`, as the existing test does.

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

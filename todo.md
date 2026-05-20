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
- [ ] Implement `get_monthly_revenue` in `src/tools/invoices/getMonthlyRevenue.ts`.
  - [ ] Accept `year` and `month`.
  - [ ] Build a Dolibarr date range for the month.
  - [ ] Fetch validated invoices, group by client, and return client totals plus grand totals.
- [ ] Implement `search_across` in `src/tools/search/searchAcross.ts`.
  - [ ] Search thirdparties, invoices, and orders in parallel.
  - [ ] Return lean grouped results with IDs, refs/names, dates, and statuses.
  - [ ] Add an orders API helper if Dolibarr order search is included.

## Existing implementation to verify

- [ ] Verify `get_invoice_detail` against the real Dolibarr API.
  - [ ] Confirm `/invoices/{id}?includeLines=1` returns lines in the expected shape.
  - [ ] Confirm invoice lookup by `ref` works with the current SQL filter.
  - [ ] Confirm payment fields such as `totalpaid`, `total_paye`, `remaintopay`, and `remaining_to_pay` are correct for this Dolibarr version.
- [ ] Update stale docs after verification.
  - [ ] `README.md` currently says some read tools are stubs but does not list `get_invoice_detail` as implemented.
  - [ ] `agents.md` still lists `get_invoice_detail` as a stub.
  - [ ] `TODO.md` refers to `src/tools/read/`, but the actual tools live under domain folders in `src/tools/`.
- [ ] Tighten `set_proposal_status`.
  - [ ] Only ignore the validate step when the proposal is already validated.
  - [ ] Do not swallow unrelated validation failures before closing the proposal.
- [ ] Confirm proposal close API shape for `POST /proposals/{id}/close`.
- [ ] Confirm supplier invoice endpoint paths.
  - [ ] Current code uses `/fourn/invoices`.
  - [ ] Some Dolibarr versions expose supplier invoices as `/fourn/factures`.
- [ ] Confirm proposal line endpoint path.
  - [ ] Current code uses `/proposals/{id}/line`.
  - [ ] Verify whether this Dolibarr version also supports or expects `/proposals/{id}/lines`.

## Dolibarr API helpers to add

- [ ] Add delete helpers for client invoices and supplier invoices so integration tests can clean up created records.
- [ ] Add get/list helpers for supplier invoices to support verification after creation.
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

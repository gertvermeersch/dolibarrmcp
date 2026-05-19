# TODO

Status legend: [ ] open · [x] done · [~] in progress

---

## 0. Project setup

- [ ] Run `npm install` to install dependencies
- [ ] Copy `.env.example` to `.env` and fill in `DOLIBARR_URL`, `DOLIBARR_API_KEY`, `MCP_API_KEY`
- [ ] Run `docker compose up` and confirm the server starts and logs the listening port
- [ ] Verify `GET /` or a test MCP call returns a response (check transport URL with MCP SDK docs)

---

## 1. Verify Dolibarr API shapes

Before implementing read tools, confirm the actual response shapes from your Dolibarr instance.
The types in `src/types/dolibarr.ts` are based on the Dolibarr REST API docs — verify and
adjust field names where needed.

- [ ] `GET /thirdparties/{id}` — confirm field names (`tva_intra`, `outstanding_balance`, etc.)
- [ ] `GET /invoices?statut=1&...` — confirm filter syntax and pagination
- [ ] `GET /invoices/{id}?includeLines=1` — confirm lines are returned inline
- [ ] `GET /proposals/{id}?includeLines=1` — confirm lines are returned inline
- [ ] `GET /fourn/invoices` — confirm endpoint path (some Dolibarr versions use `/fourn/factures`)
- [ ] `POST /proposals/{id}/close` — confirm body shape for accepted/refused status

Tip: use the Dolibarr API explorer at `{DOLIBARR_URL}/explorer` to test calls directly.

---

## 2. Implement read tools

Each stub is in `src/tools/read/`. Follow `searchProducts.ts` as the reference pattern.

### `get_invoice_detail`

File: `src/tools/read/getInvoiceDetail.ts`

- [ ] Accept invoice ref (e.g. `FA2024-0042`) or numeric ID
- [ ] If ref string: search invoices by ref, resolve to ID
- [ ] Call `getInvoice(id)` from `src/dolibarr/invoices.ts`
- [ ] Fetch the associated thirdparty in parallel (`getThirdparty(invoice.socid)`)
- [ ] Return a flat, human-readable object: ref, date (ISO), client name, status label,
      totals (excl/incl tax), lines with resolved labels

Status labels to resolve:
```
0 = Draft · 1 = Validated · 2 = Paid · 3 = Abandoned
```

---

### `get_client_overview`

File: `src/tools/read/getClientOverview.ts`

- [ ] Call `resolveThirdparty(client)` — return error if not found/ambiguous
- [ ] In parallel, fetch:
  - Thirdparty detail (`GET /thirdparties/{id}`)
  - Open invoices (`GET /invoices?socid={id}&statut=1`)
  - Contacts (`GET /thirdparties/{id}/contacts`)
- [ ] Compute unpaid balance (sum of `total_ttc` across open invoices)
- [ ] Find last order date (if orders endpoint available: `GET /orders?socid={id}&limit=1&sortfield=date_commande&sortorder=DESC`)
- [ ] Return: company info, contacts list, open invoice count + unpaid balance, last order date

---

### `get_outstanding_receivables`

File: `src/tools/read/getOutstandingReceivables.ts`

- [ ] Fetch all unpaid (validated, not paid) invoices: `GET /invoices?statut=1&limit=500`
- [ ] Fetch thirdparty names for all unique `socid` values in parallel
- [ ] Group invoices by client
- [ ] For each invoice, compute age in days from `date_lim_reglement` (due date)
- [ ] Bucket into: 0–30, 31–60, 61–90, 90+ days overdue
- [ ] Return grouped summary with per-client totals and bucket breakdown

---

### `get_monthly_revenue`

File: `src/tools/read/getMonthlyRevenue.ts`

- [ ] Accept `year` and `month` (1–12)
- [ ] Compute Unix timestamp range for start and end of month
- [ ] Fetch validated invoices in range: `GET /invoices?statut=1&date_min={start}&date_max={end}&limit=500`
- [ ] Fetch thirdparty names for all unique `socid` values in parallel
- [ ] Group by client, sum `total_ht` and `total_ttc`
- [ ] Return: per-client breakdown + grand totals excl. and incl. tax

---

### `search_across`

File: `src/tools/read/searchAcross.ts`

- [ ] Run three searches in parallel:
  - `searchThirdparties(query)` from `src/dolibarr/thirdparties.ts`
  - `GET /invoices?sqlfilters=(t.ref like '%{query}%')&limit=5`
  - `GET /orders?sqlfilters=(t.ref like '%{query}%')&limit=5` (add `src/dolibarr/orders.ts` if needed)
- [ ] Return results grouped by type: `{ thirdparties: [...], invoices: [...], orders: [...] }`
- [ ] Keep results lean: id, ref/name, date, status — no full detail

---

## 3. Fix Dolibarr API module issues (if found during step 1)

- [ ] Correct `/fourn/invoices` path if Dolibarr uses `/fourn/factures`
- [ ] Correct `POST /proposals/{id}/close` body if the actual shape differs
- [ ] Add `src/dolibarr/orders.ts` if needed for `get_client_overview` and `search_across`

---

## 4. Production hardening

- [ ] Add request timeout to `dolibarr/client.ts` (e.g. `AbortSignal.timeout(10_000)`)
- [ ] Add basic logging (startup, per-request tool name, errors) — `console.log` is fine for v1
- [ ] Test `docker compose up` with `target: prod` build to confirm production image works
- [ ] Write a `README.md` covering: setup, env vars, Docker usage, connecting to Claude.ai

---

## 5. Claude.ai connector setup (once deployed)

- [ ] Deploy to VPS: `docker compose up -d` behind Traefik or nginx with HTTPS
- [ ] Add connector in Claude.ai settings: URL = `https://dolibarr-mcp.yourdomain.com`, key = `MCP_API_KEY`
- [ ] Smoke test each tool from Claude.ai chat

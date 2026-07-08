# Delete-phase test findings — 3 issues

Ran the full delete suite with `MCP_ALLOW_DELETES=true` (2026-07-07). The guards are solid:
env kill-switch, `confirm`/dry-run, numeric-ID-only, clean `NOT_FOUND` on bad ids, and
idempotent already-draft reopen all pass. Draft deletes for invoices, proposals, and supplier
invoices all work and were verified gone. Proposal and **supplier-invoice** reopen→delete both
work. Three issues remain, in priority order.

---

## Issue 1 (HIGH) — client-invoice reopen fails: missing `idwarehouse`

Reopening a **validated client invoice** to draft fails, which also breaks the
`reopen_if_validated` delete path for client invoices.

### Evidence
- `set_invoice_status(538, "draft")` → `400 Bad Request: Invalid value specified for
  idwarehouse. Expecting integer value`.
- `delete_invoice(534, confirm:true, reopen_if_validated:true)` → same `400 idwarehouse`.

### Cause
Dolibarr's customer-invoice `setToDraft` decrements stock when the stock module (or "increase
stock on validation") is active, and then requires an `idwarehouse` parameter. The tool calls
the reopen endpoint without it.

### Fix options
- Add an optional `warehouse_id` param to `set_invoice_status` / `delete_invoice`, and pass it
  through to Dolibarr's setToDraft when reopening.
- Or detect the stock-module condition and pass a configured default warehouse
  (env `DOLIBARR_DEFAULT_WAREHOUSE_ID`).
- Or, if stock tracking isn't used for invoices, call setToDraft with the "no stock movement"
  option.

### Not affected
Supplier-invoice reopen→delete works cleanly (`delete_supplier_invoice(301,
reopen_if_validated:true)` → deleted). This is specific to **customer** invoices.

---

## Issue 2 (MEDIUM) — `delete_invoice` missing the `MUST_REOPEN` precheck

`delete_proposal` correctly pre-checks status and returns a clean guard; `delete_invoice` does
not — it attempts the delete and leaks Dolibarr's raw 403.

### Evidence
- `delete_invoice(533, confirm:true)` on a validated invoice →
  `Dolibarr API error 403: Forbidden: Invoice not erasable`.
- `delete_proposal(138, confirm:true)` on an accepted proposal →
  `{ error: "MUST_REOPEN", message: "Proposal ... is not draft. Re-run with reopen_if_closed:true, or set it to draft first." }`  ← the desired pattern.

### Fix
Give `delete_invoice` (and `delete_supplier_invoice`) the same status precheck
`delete_proposal` already has: if not draft and the reopen flag is absent, return a clean
`MUST_REOPEN` instead of calling Dolibarr's delete. (Depends on Issue 1 for the reopen path to
actually succeed afterward.)

---

## Issue 3 (HIGH) — `delete_thirdparty` hard-depends on the Customer orders module

The linked-document precheck queries the Customer orders API unconditionally. With that module
inactive (this environment), **every** `delete_thirdparty` on an existing record fails — even
one with no documents at all — so thirdparties can't be deleted or self-cleaned.

### Evidence
- `delete_thirdparty(258, confirm:true)` — 258 has **no** documents →
  `{ error: "DOLIBARR_MODULE_UNAVAILABLE", message: "Dolibarr refused access to the Customer
  orders API. The module may be inactive or the API user may be missing permissions." }`.
- Same for `delete_thirdparty(254)` (which does have linked docs) — errors before it can
  return the intended `HAS_LINKED_DOCUMENTS`.
- `delete_thirdparty(99999999)` → clean `NOT_FOUND` (existence check runs first, so bad ids are fine).

### Fix
Make the linked-document precheck **degrade gracefully** when a module/endpoint is
unavailable: catch the orders-API error and treat orders as `0`/`unknown` (skip that entity)
rather than aborting the whole delete. Optionally surface it, e.g.
`linked: { invoices: N, proposals: N, supplier_invoices: N, orders: "unavailable" }`.
Consider the same resilience for any other module-gated entity in the precheck.

---

## Confirmed working (no action)
Env kill-switch (`DELETES_DISABLED` when off); dry-run preview when on; numeric-ID-only
(schema); clean `NOT_FOUND` on bad ids across all delete + status tools; idempotent
already-draft reopen (`Already draft.`); draft delete for invoice/proposal/supplier invoice
(verified gone); proposal reopen→delete; **supplier-invoice** reopen→delete; graceful
`UNSUPPORTED_STATUS` message for the unsupported `abandoned` transition.

## Cleanup left behind (blocked by Issues 1 & 3)
Deleted OK: invoices 535/536/537/547; proposals 136/137/138/139; supplier invoices 299/300/301.
**Still present (need bug fixes or manual UI removal):** validated invoices 533, 534, 538
(Issue 1); thirdparties 254, 255, 256, 257, 258, 296, 297 (Issue 3).

# Write-phase test findings — 3 issues

Found during the write-test phase on 2026-07-06. All tools are otherwise functional:
creates, catalog resolution, overrides, mixed lines, validate, proposal status flow, and
supplier invoices all work, and the shared serializer fixes are confirmed on line items and
supplier-invoice detail. Three issues below, in priority order.

---

## Issue 1 (HIGH, functional) — `create_thirdparty` silently drops `is_supplier`

The `is_supplier` flag is not persisted. Client flag works; supplier flag is lost.

### Evidence
- Created id 255 with `is_supplier: true` (only). Reads back as:
  ```json
  { "id": 255, "name": "ZZ Test Supplier - MCP", "type": "other", "is_client": false, "is_supplier": false }
  ```
- Created id 256 with `is_client: true` AND `is_supplier: true`. Reads back as:
  ```json
  { "id": 256, "name": "ZZ Test Both - MCP", "type": "client", "is_client": true, "is_supplier": false }
  ```
Expected: 255 → `is_supplier: true` (`type: "supplier"`); 256 → both true (`type: "both"`).

### Likely cause
Dolibarr's thirdparty API maps supplier status to the `fournisseur` field (0/1), separate
from `client` (0/1/2/3). The tool likely sets `client` but never sets `fournisseur`. Check
the create payload mapping:
```
client     = is_client   ? 1 : 0
fournisseur = is_supplier ? 1 : 0    // <-- verify this is being sent
```
Note: a thirdparty with neither flag becomes `type: "other"` (see 255), which is why it fell
through. (Dolibarr still allowed supplier invoices against 255, so it's permissive — but the
flag is wrong.)

### Regression test
`create_thirdparty(name, is_supplier=true)` then read back → `is_supplier: true`.
`create_thirdparty(name, is_client=true, is_supplier=true)` → both true, `type: "both"`.

---

## Issue 2 (HIGH, functional) — date stored one day earlier than input

Every `create_invoice` / `create_proposal` / `create_supplier_invoice` stored the date one
day before the input.

### Evidence
Input `date: "2026-07-05"` on invoices 533–538, proposals, and supplier invoice 299 — all
read back with `dates.invoice: "2026-07-04"`.

### Likely cause
Timezone handling: the `YYYY-MM-DD` string is probably parsed as midnight UTC then converted
to a server/local timezone behind UTC (or vice versa), shifting the calendar day. Parse the
date as a timezone-neutral calendar date (or set noon/local) before sending to Dolibarr, and
confirm Dolibarr's expected format (Unix timestamp vs `YYYY-MM-DD`).

### Regression test
Create with `date: "2026-07-05"` → detail shows `2026-07-05`. Test with a client in a
non-UTC timezone and around DST boundaries.

---

## Issue 3 (MEDIUM, error handling) — raw Dolibarr errors leak, with debug stack traces

Operations that pass a raw ID (or required field) straight to Dolibarr return the raw
Dolibarr error payload, including a `debug.source` file:line stack trace. This is noisy for
an LLM client and leaks internal implementation paths.

### Evidence
- `create_thirdparty(name="")` → `500 ... "ErrorBadThirdPartyName"` + `debug.source:
  api_thirdparties.class.php:342`.
- `validate_invoice(99999999)` → `404 Invoice not found` + `debug.source: api_invoices.class.php:1157`.
- `validate_proposal(99999999)` and `set_proposal_status(99999999)` → `404` + `api_proposals.class.php:1067`.
- `create_supplier_invoice` duplicate ref → `500 ErrorRefAlreadyExists` + debug stack.
- Re-validating an already-validated invoice/proposal → `"Dolibarr API error 304: "` (empty
  message; cryptic but harmless).

### Contrast — the correct pattern already exists
- `create_supplier_invoice(supplier_invoice_ref="")` → clean MCP schema error
  (`minLength 1`). **Apply the same `minLength(1)` to `create_thirdparty.name`** — that alone
  fixes the empty-name 500.
- `update_thirdparty("zzzznope")`, `create_invoice(client="zzzznope")`, and the `get_*`
  not-found paths all return clean, resolved errors. The passthrough tools should do the same.

### Fix
1. Add input validation (`minLength(1)`) on required string fields, matching `supplier_invoice_ref`.
2. Wrap Dolibarr API calls in a normalizer that strips `debug`, maps common Dolibarr codes to
   clean messages, and never forwards the stack trace. Suggested mappings:
   - `404` → `{ error: "NOT_FOUND", message: "<entity> <id> not found." }`
   - `304` (already validated) → `{ success: true, status: "validated", note: "Already validated." }`
   - `500 ErrorRefAlreadyExists` → `{ error: "DUPLICATE_REF", message: "Supplier invoice ref '<ref>' already exists for this supplier." }`
   - `500 ErrorBadThirdPartyName` → `{ error: "VALIDATION_ERROR", message: "Thirdparty name is required." }`

### Regression test
`validate_invoice(99999999)` → clean not-found, no `debug` key. `create_thirdparty(name="")`
→ clean validation error. Re-validate an already-validated doc → clean idempotent success.

---

## Confirmed working (no action)
Clean create responses with per-line resolution feedback; catalog copy + price/VAT override;
mixed free-text/catalog lines; rounding (no long-tail floats); one-call create+validate (real
ref assigned); proposal accept/refuse incl. internal validate→close from draft; notes params
accepted; supplier-invoice detail fully clean (shared serializer inherited: `line_id`, numeric
`qty`/`vat_rate`, resolved supplier, status labels); duplicate thirdparty names allowed;
ref-uniqueness enforced on supplier invoices.

# Spec: delete tools + reopen for Dolibarr MCP

## Goal
Add guarded delete capability so the test harness (and users) can remove records — and so
regression runs can self-clean instead of relying on manual Dolibarr UI teardown.

## Scope
New tools: `delete_invoice`, `delete_proposal`, `delete_supplier_invoice`,
`delete_thirdparty`, plus a reopen/status tool `set_invoice_status` (and the same for
supplier invoices, or one combined tool). These are the most destructive tools in the server;
the guard rules below are part of the spec, not optional.

---

## Dolibarr constraints that shape the design
1. **Validated/closed financial documents cannot be hard-deleted.** A validated invoice,
   validated supplier invoice, or accepted/refused/billed proposal must first be reopened
   (set back to draft) — or, for invoices, marked abandoned — before deletion.
2. **A thirdparty with linked documents cannot be deleted.** Dolibarr returns a raw 500;
   the tool must detect this and return a clean, informative refusal.
3. Dolibarr's delete endpoints return the raw error payloads seen in the write-phase tests
   (404 + `debug.source` stack). All new tools must run responses through the **Issue 3 error
   normalizer** (strip `debug`, map codes to clean messages).

---

## Guard rules (apply to every delete tool)
- **ID only — never fuzzy resolution.** Delete tools accept the internal Dolibarr **numeric
  ID** only. Do NOT resolve by name (avoids "delete matching 'van'" hitting the wrong record).
  This is the opposite of the read/create tools, and intentional.
- **`confirm` required.** Each delete takes `confirm: true`. Without it, the tool performs a
  **dry run**: returns what *would* be deleted (entity type, id, ref, status, and — for
  thirdparties — linked-document counts) and deletes nothing.
- **Production safety switch.** Honor an env flag (e.g. `MCP_ALLOW_DELETES`). When unset/false,
  delete tools return a clean "deletes are disabled in this environment" error. Lets prod
  deployments expose the tools read-safe.
- **No cascade by default.** Deleting a thirdparty does NOT delete its documents. The tool
  reports the blockers; the caller clears them first (or passes an explicit opt-in — see below).

---

## Tool signatures

### `set_invoice_status`
Reopen or change a client invoice's status (needed to delete validated invoices).
```
set_invoice_status(invoice_id: number, status: "draft" | "validated" | "abandoned",
                   notrigger?: number)
```
- `"draft"` reopens a validated invoice. Idempotent: reopening an already-draft invoice
  returns a clean success (`note: "Already draft."`), matching the validate_invoice 304 fix.
- Returns `{ success, invoice_id, status }`.

*(Optional but recommended: `set_supplier_invoice_status` with the same shape for supplier
invoices. Proposals already have `set_proposal_status` + `validate_proposal`; add a
`reopen`/`draft` path there if not present.)*

### `delete_invoice`
```
delete_invoice(invoice_id: number, confirm?: boolean, reopen_if_validated?: boolean)
```
- Draft → delete.
- Validated + `reopen_if_validated: true` → reopen to draft, then delete (internal, mirrors
  the `set_proposal_status` validate→close pattern).
- Validated + `reopen_if_validated` omitted/false → clean refusal:
  `{ error: "MUST_REOPEN", message: "Invoice <ref> is validated. Re-run with reopen_if_validated:true, or set it to draft first." }`
- `confirm` omitted → dry run.
- Returns `{ success: true, deleted: true, invoice_id }`.

### `delete_proposal`
```
delete_proposal(proposal_id: number, confirm?: boolean, reopen_if_closed?: boolean)
```
- Draft → delete. Validated/accepted/refused/billed + `reopen_if_closed: true` → reopen then
  delete; otherwise clean `MUST_REOPEN` refusal.

### `delete_supplier_invoice`
```
delete_supplier_invoice(supplier_invoice_id: number, confirm?: boolean, reopen_if_validated?: boolean)
```
Same rules as `delete_invoice`.

### `delete_thirdparty`
```
delete_thirdparty(thirdparty_id: number, confirm?: boolean)
```
- No linked documents → delete.
- Has linked documents → clean refusal that reports the blockers:
  `{ error: "HAS_LINKED_DOCUMENTS", message: "Thirdparty <name> has linked documents.",
     linked: { invoices: N, proposals: N, supplier_invoices: N, orders: N } }`
- Never cascades. The caller deletes the documents first.

---

## Acceptance criteria
1. All delete tools accept numeric ID only; passing a name/string returns a clean validation
   error (no fuzzy resolution attempted).
2. Without `confirm`, nothing is deleted and the response describes what would be.
3. With `MCP_ALLOW_DELETES` unset/false, every delete tool refuses cleanly and deletes nothing.
4. Draft documents delete successfully; a follow-up `get_*` returns clean not-found.
5. Validated/closed documents: refused with `MUST_REOPEN` unless the reopen flag is passed;
   with the flag, they reopen and delete in one call.
6. `delete_thirdparty` on a record with documents refuses with `HAS_LINKED_DOCUMENTS` and the
   per-type counts; nothing is deleted. After documents are cleared, the delete succeeds.
7. `set_invoice_status(..., "draft")` reopens a validated invoice; reopening a draft is a
   clean idempotent success.
8. No response contains a Dolibarr `debug` block or stack trace (Issue 3 normalizer applied).
9. Bad ID on any tool → clean `NOT_FOUND`.

## Self-clean bonus
Once these land, the harness can tear down a run by: delete drafts directly → reopen+delete
validated docs → delete thirdparties last. Consider a thin `cleanup` helper or documented
sequence. This directly replaces the manual teardown checklist.

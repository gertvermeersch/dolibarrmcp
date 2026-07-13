import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
// Enable deletes so the guarded flow runs past the enablement check.
process.env.MCP_ALLOW_DELETES = "true";

const { runGuardedDelete } = await import("../../src/tools/shared/deleteGuards.js");

interface Doc {
  ref?: string;
  statut?: number;
}

function baseOptions(doc: Doc) {
  const calls: string[] = [];
  const options = {
    entityType: "invoice",
    entityLabel: "Invoice",
    idKey: "invoice_id",
    reopenFlag: "reopen_if_validated",
    id: 7,
    confirm: true,
    reopen: false,
    fetch: async () => doc,
    statusLabel: (d: Doc) => (d.statut === 0 ? "draft" : "validated"),
    reopenToDraft: async () => {
      calls.push("reopen");
    },
    remove: async () => {
      calls.push("remove");
    },
  };
  return { options, calls };
}

test("returns a dry run without deleting when confirm is false", async () => {
  const { options, calls } = baseOptions({ ref: "FA-7", statut: 0 });
  options.confirm = false;

  const result = await runGuardedDelete(options);

  assert.deepEqual(result, {
    delete_enabled: true,
    dry_run: true,
    would_delete: true,
    entity_type: "invoice",
    id: 7,
    ref: "FA-7",
    status: "draft",
  });
  assert.deepEqual(calls, []);
});

test("deletes a draft document without reopening", async () => {
  const { options, calls } = baseOptions({ ref: "FA-7", statut: 0 });

  const result = await runGuardedDelete(options);

  assert.deepEqual(result, { success: true, deleted: true, invoice_id: 7 });
  assert.deepEqual(calls, ["remove"]);
});

test("refuses to delete a non-draft document without reopen", async () => {
  const { options, calls } = baseOptions({ ref: "FA-7", statut: 1 });

  const result = await runGuardedDelete(options);

  assert.equal(result.error, "MUST_REOPEN");
  assert.match(String(result.message), /reopen_if_validated:true/);
  assert.deepEqual(calls, []);
});

test("reopens then deletes a non-draft document when reopen is set", async () => {
  const { options, calls } = baseOptions({ ref: "FA-7", statut: 1 });
  options.reopen = true;

  const result = await runGuardedDelete(options);

  assert.deepEqual(result, { success: true, deleted: true, invoice_id: 7 });
  assert.deepEqual(calls, ["reopen", "remove"]);
});

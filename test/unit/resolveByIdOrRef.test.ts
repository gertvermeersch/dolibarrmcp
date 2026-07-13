import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { resolveByIdOrRef } = await import("../../src/tools/shared/resolveByIdOrRef.js");
const { DolibarrApiError } = await import("../../src/dolibarr/errors.js");

const decodeQuery = (params: string) => decodeURIComponent(params.replace(/\+/g, " "));

interface Entity {
  id: string | number;
  ref: string;
}

test("fetches by numeric ID without listing", async () => {
  const entity: Entity = { id: 42, ref: "FA-42" };
  let listed = false;

  const result = await resolveByIdOrRef("42", {
    getById: async (id) => {
      assert.equal(id, 42);
      return entity;
    },
    list: async () => {
      listed = true;
      return [];
    },
  });

  assert.equal(result, entity);
  assert.equal(listed, false);
});

test("returns undefined when a numeric ID is not found", async () => {
  const result = await resolveByIdOrRef("99999999", {
    getById: async () => {
      throw new DolibarrApiError(404, "not found", "/invoices/99999999");
    },
    list: async () => [],
  });

  assert.equal(result, undefined);
});

test("rethrows unexpected API errors for numeric input", async () => {
  await assert.rejects(
    resolveByIdOrRef("42", {
      getById: async () => {
        throw new DolibarrApiError(500, "boom", "/invoices/42");
      },
      list: async () => [],
    }),
    /boom/,
  );
});

test("resolves a reference via list then re-fetches by ID", async () => {
  let listParams = "";
  const full: Entity = { id: 7, ref: "FA-7" };

  const result = await resolveByIdOrRef("FA-7", {
    getById: async (id) => {
      assert.equal(id, 7);
      return full;
    },
    list: async (params) => {
      listParams = params;
      return [{ id: 7, ref: "FA-7" }];
    },
  });

  assert.equal(result, full);
  assert.match(decodeQuery(listParams), /\(t\.ref:=:'FA-7'\)/);
  assert.match(listParams, /limit=1/);
});

test("returns undefined when no reference matches", async () => {
  const result = await resolveByIdOrRef("MISSING", {
    getById: async () => {
      throw new Error("should not fetch");
    },
    list: async () => [],
  });

  assert.equal(result, undefined);
});

test("OR-joins multiple ref columns", async () => {
  let listParams = "";

  await resolveByIdOrRef("SUP-1", {
    getById: async () => ({ id: 1, ref: "SI-1" }),
    list: async (params) => {
      listParams = params;
      return [{ id: 1, ref: "SI-1" }];
    },
    refColumns: ["t.ref", "t.ref_supplier"],
  });

  assert.match(decodeQuery(listParams), /\(t\.ref:=:'SUP-1'\) OR \(t\.ref_supplier:=:'SUP-1'\)/);
});

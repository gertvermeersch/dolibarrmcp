import assert from "node:assert/strict";
import test from "node:test";
import { DolibarrApiError } from "../../src/dolibarr/errors.js";
import {
  documentContentTypes,
  searchDocumentContent,
  type DocumentContentSearchDependencies,
  type DocumentContentType,
} from "../../src/tools/search/documentContentSearch.js";
import type { DolibarrOrder, DolibarrThirdparty } from "../../src/types/dolibarr.js";

type TestDocument = Pick<DolibarrOrder, "id" | "ref" | "socid" | "lines">;

function dependenciesFor(
  documents: Partial<Record<DocumentContentType, TestDocument[]>>,
  unavailable: DocumentContentType[] = [],
): DocumentContentSearchDependencies {
  const domains = Object.fromEntries(documentContentTypes.map((type) => [type, {
    list: async (limit: number) => {
      if (unavailable.includes(type)) {
        throw new DolibarrApiError(403, "Forbidden", `/${type}`);
      }
      return (documents[type] ?? []).slice(0, limit);
    },
    get: async (id: number) => {
      const document = (documents[type] ?? []).find((candidate) => candidate.id === id);
      if (!document) throw new DolibarrApiError(404, "Not found", `/${type}/${id}`);
      return document;
    },
  }])) as DocumentContentSearchDependencies["domains"];

  return {
    domains,
    getThirdparty: async (id: number) => ({
      id,
      name: id === 20 ? "Supplier NV" : "Client BV",
      client: id === 20 ? 0 : 1,
      supplier: id === 20 ? 1 : 0,
    } satisfies DolibarrThirdparty),
  };
}

test("searches descriptions across every supported document type", async () => {
  const result = await searchDocumentContent({ query: "NEEDLE" }, dependenciesFor({
    proposal: [{
      id: 1,
      ref: "PR-1",
      socid: 10,
      lines: [{ id: 101, desc: "Proposal needle work", product_ref: "SERV-1" } as never],
    }],
    order: [{
      id: 2,
      ref: "OR-2",
      socid: 10,
      lines: [{ id: 102, desc: "Order Needle work" } as never],
    }],
    client_invoice: [{
      id: 3,
      ref: "INV-3",
      socid: 10,
      lines: [{ id: 103, description: "Invoice needle work", productRef: "SERV-3" } as never],
    }],
    supplier_invoice: [{
      id: 4,
      ref: "SUP-4",
      socid: 20,
      lines: [{ id: 104, desc: "Supplier needle work", ref_product: "PART-4" } as never],
    }],
  }));

  assert.equal(result.match_count, 4);
  assert.deepEqual(
    (result.matches as Array<Record<string, unknown>>).map((match) => match.document_type),
    [...documentContentTypes],
  );
  assert.deepEqual((result.matches as Array<Record<string, unknown>>)[0], {
    document_type: "proposal",
    document_id: 1,
    document_ref: "PR-1",
    line_id: 101,
    product_ref: "SERV-1",
    description: "Proposal needle work",
    thirdparty_name: "Client BV",
  });
  assert.equal(
    (result.matches as Array<Record<string, unknown>>)[3].thirdparty_name,
    "Supplier NV",
  );
});

test("bounds recent-document scans and reports result truncation", async () => {
  const documents = [1, 2, 3].map((id): TestDocument => ({
    id,
    ref: `INV-${id}`,
    socid: 10,
    lines: [{ id: 100 + id, desc: `needle ${id}` } as never],
  }));

  const result = await searchDocumentContent({
    query: "needle",
    documentTypes: ["client_invoice"],
    maxDocumentsPerType: 2,
    limit: 1,
  }, dependenciesFor({ client_invoice: documents }));

  assert.equal(result.match_count, 1);
  assert.equal(result.total_matches_in_scanned_documents, 2);
  assert.equal(result.results_truncated, true);
  assert.deepEqual(result.scan, {
    client_invoice: {
      available: true,
      documents_considered: 2,
      documents_fetched: 2,
      matched_lines: 2,
      more_documents_available: true,
    },
  });
});

test("marks inaccessible document modules unavailable without failing other results", async () => {
  const result = await searchDocumentContent({
    query: "needle",
    documentTypes: ["proposal", "order"],
  }, dependenciesFor({
    order: [{
      id: 2,
      ref: "OR-2",
      socid: 10,
      lines: [{ id: 102, desc: "needle" } as never],
    }],
  }, ["proposal"]));

  assert.equal(result.match_count, 1);
  assert.deepEqual((result.scan as Record<string, unknown>).proposal, {
    available: false,
    documents_considered: 0,
    documents_fetched: 0,
    matched_lines: 0,
    more_documents_available: false,
  });
});

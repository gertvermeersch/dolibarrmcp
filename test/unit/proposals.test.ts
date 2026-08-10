import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";

const { createProposal, DEFAULT_PROPOSAL_VALIDITY_DAYS } = await import(
  "../../src/dolibarr/proposals.js"
);

test("defaults new proposals to 30 days of validity", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response("42", { status: 200 });
  };

  try {
    const proposalId = await createProposal({
      socid: 7,
      date: Date.UTC(2026, 4, 19, 12) / 1000,
    });

    assert.equal(proposalId, 42);
    assert.deepEqual(requestBody, {
      duree_validite: DEFAULT_PROPOSAL_VALIDITY_DAYS,
      socid: 7,
      date: Date.UTC(2026, 4, 19, 12) / 1000,
    });
    assert.equal(DEFAULT_PROPOSAL_VALIDITY_DAYS, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

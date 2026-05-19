import assert from "node:assert/strict";
import test from "node:test";
import type { DolibarrProduct } from "../../src/types/dolibarr.js";

const hasDolibarrCredentials = Boolean(process.env.DOLIBARR_URL && process.env.DOLIBARR_API_KEY);

if (!process.env.MCP_API_KEY) {
  process.env.MCP_API_KEY = "integration-test";
}

async function loadApi() {
  return {
    ...(await import("../../src/dolibarr/client.js")),
    ...(await import("../../src/dolibarr/thirdparties.js")),
    ...(await import("../../src/dolibarr/proposals.js")),
    ...(await import("../../src/dolibarr/documents/documentCreationService.js")),
  };
}

function uniqueName(prefix: string): string {
  return `${prefix} ${new Date().toISOString()} ${Math.random().toString(36).slice(2, 8)}`;
}

test("creates, reads, and deletes a thirdparty in the real Dolibarr API", {
  skip: hasDolibarrCredentials ? false : "Set DOLIBARR_URL and DOLIBARR_API_KEY to run real API tests.",
}, async () => {
  const { createThirdparty, deleteThirdparty, getThirdparty, isDolibarrNotFoundError } = await loadApi();
  const name = uniqueName("MCP Integration Thirdparty");
  const id = await createThirdparty({
    name,
    client: 1,
    supplier: 0,
    email: `mcp-it-${Date.now()}@example.test`,
    town: "Integration Test",
  });

  try {
    assert.equal(typeof id, "number");

    const created = await getThirdparty(id);
    assert.equal(Number(created.id), id);
    assert.equal(created.name, name);
    assert.equal(Number(created.client), 1);
  } finally {
    await deleteThirdparty(id);
  }

  await assert.rejects(
    () => getThirdparty(id),
    (err) => isDolibarrNotFoundError(err),
  );
});

test("creates and validates a proposal with an existing service line and a free-text line", {
  skip: hasDolibarrCredentials ? false : "Set DOLIBARR_URL and DOLIBARR_API_KEY to run real API tests.",
}, async (t) => {
  const {
    DocumentCreationService,
    addProposalLine,
    createProposal,
    deleteProposal,
    createThirdparty,
    deleteThirdparty,
    dolibarr,
    getProposal,
    validateProposal,
  } = await loadApi();
  // Get a service that is active for sale; deactivated services make proposal validation fail.
  const serviceParams = new URLSearchParams({
    mode: "2",
    limit: "1",
    sqlfilters: "(t.tosell:=:1)",
  });
  const services = await dolibarr.get<DolibarrProduct[]>(`/products?${serviceParams}`);
  const catalogService = services[0];
  if (!catalogService) {
    t.skip("Dolibarr has no active service product available for the existing-service line.");
    return;
  }

  const clientName = uniqueName("MCP Integration Proposal Client");
  const clientId = await createThirdparty({
    name: clientName,
    client: 1,
    supplier: 0,
    town: "Integration Test",
  });

  let proposalId: number | undefined;
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const service = new DocumentCreationService({
      create: createProposal,
      addLine: addProposalLine,
      validate: validateProposal,
    });

    const result = await service.create({
      thirdparty: String(clientId),
      date: "2026-05-19",
      validate: true,
      lines: [
        {
          product_ref: catalogService.ref,
          qty: 1,
        },
        {
          description: "Integration test free-text service line",
          qty: 2,
          unit_price: 42,
          vat_rate: 21,
        },
      ],
    });

    assert.equal("success" in result, true);
    if (!("success" in result)) {
      assert.fail(`Expected proposal creation success, got ${JSON.stringify(result)}`);
    }

    proposalId = result.id;
    assert.equal(result.validated, true);
    assert.equal(result.lines.length, 2);
    assert.equal(result.lines[0].product_ref, catalogService.ref);
    assert.equal(result.lines[1].resolved, false);

    const proposal = await getProposal(proposalId);
    assert.equal(Number(proposal.id), proposalId);
    assert.equal(Number(proposal.socid), clientId);
    assert.ok(Number(proposal.statut) > 0, `Expected validated proposal status, got ${proposal.statut}`);
    assert.ok((proposal.lines?.length ?? 0) >= 2);
  } catch (err) {
    testError = err;
  } finally {
    if (proposalId !== undefined) {
      await deleteProposal(proposalId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
  }

  if (testError !== undefined) {
    if (cleanupErrors.length > 0 && testError instanceof Error) {
      Object.assign(testError, { cleanupErrors });
    }
    throw testError;
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Failed to clean up Dolibarr integration test records.");
  }
});

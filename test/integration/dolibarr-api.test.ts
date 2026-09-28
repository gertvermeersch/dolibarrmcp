import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DolibarrProduct } from "../../src/types/dolibarr.js";
import { isoDateFromTimestamp } from "../../src/tools/shared/normalization.js";


const hasDolibarrCredentials = Boolean(process.env.DOLIBARR_URL && process.env.DOLIBARR_API_KEY);
const testRecordPrefix = "MCP Integration";
const allowProductionIntegrationTests = process.env.DOLIBARR_ALLOW_PRODUCTION_INTEGRATION_TESTS === "true";

if (!process.env.MCP_API_KEY) {
  process.env.MCP_API_KEY = "integration-test";
}

function looksLikeProductionDolibarrUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const parts = [parsed.hostname, parsed.pathname]
      .join(" ")
      .split(/[^a-z0-9]+/i)
      .filter(Boolean);

    return parts.some((part) => ["prod", "production", "live"].includes(part.toLowerCase()));
  } catch {
    return /\b(prod|production|live)\b/i.test(url);
  }
}

function integrationTestSkipReason(): false | string {
  if (!hasDolibarrCredentials) {
    return "Set DOLIBARR_URL and DOLIBARR_API_KEY to run real API tests.";
  }

  if (!allowProductionIntegrationTests && looksLikeProductionDolibarrUrl(process.env.DOLIBARR_URL)) {
    return "DOLIBARR_URL looks production-like. Point tests at a development Dolibarr instance, or set DOLIBARR_ALLOW_PRODUCTION_INTEGRATION_TESTS=true to override intentionally.";
  }

  return false;
}

async function loadApi() {
  return {
    ...(await import("../../src/dolibarr/client.js")),
    ...(await import("../../src/dolibarr/invoices.js")),
    ...(await import("../../src/dolibarr/products.js")),
    ...(await import("../../src/dolibarr/supplierInvoices.js")),
    ...(await import("../../src/dolibarr/thirdparties.js")),
    ...(await import("../../src/dolibarr/proposals.js")),
    ...(await import("../../src/dolibarr/documents/documentCreationService.js")),
    ...(await import("../../src/tools/catalog/searchProducts.js")),
    ...(await import("../../src/tools/catalog/searchServices.js")),
    ...(await import("../../src/tools/catalog/updateProduct.js")),
    ...(await import("../../src/tools/catalog/updateService.js")),
    ...(await import("../../src/tools/invoices/getInvoiceDetail.js")),
    ...(await import("../../src/tools/invoices/getMonthlyRevenue.js")),
    ...(await import("../../src/tools/invoices/getOutstandingReceivables.js")),
    ...(await import("../../src/tools/invoices/getSupplierInvoiceDetail.js")),
    ...(await import("../../src/tools/invoices/updateInvoice.js")),
    ...(await import("../../src/tools/invoices/updateSupplierInvoice.js")),
    ...(await import("../../src/tools/proposals/setProposalStatus.js")),
    ...(await import("../../src/tools/proposals/updateProposal.js")),
    ...(await import("../../src/tools/search/searchAcross.js")),
    ...(await import("../../src/tools/search/searchDocumentContent.js")),
    ...(await import("../../src/tools/thirdparties/getClientOverview.js")),
    ...(await import("../../src/tools/thirdparties/searchThirdparties.js")),
    ...(await import("../../src/dolibarr/errors.js"))
  };
}

function integrationLabel(label: string): string {
  return `${testRecordPrefix} ${label}`;
}

function uniqueName(label: string): string {
  return `${integrationLabel(label)} ${new Date().toISOString()} ${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueRef(label: string): string {
  return `${integrationLabel(label)} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dolibarrDateFromTimestamp(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = isoDateFromTimestamp(value);
  assert.ok(date, `Expected valid Dolibarr date timestamp, got ${String(value)}`);
  return date;
}

async function findActiveService(
  dolibarr: { get<T>(path: string): Promise<T> },
): Promise<DolibarrProduct | undefined> {
  const serviceParams = new URLSearchParams({
    mode: "2",
    limit: "1",
    sqlfilters: "(t.tosell:=:1)",
  });
  const services = await dolibarr.get<DolibarrProduct[]>(`/products?${serviceParams}`);
  return services[0];
}

async function findActiveProduct(
  dolibarr: { get<T>(path: string): Promise<T> },
): Promise<DolibarrProduct | undefined> {
  const productParams = new URLSearchParams({
    mode: "1",
    limit: "1",
    sqlfilters: "(t.tosell:=:1)",
  });
  const products = await dolibarr.get<DolibarrProduct[]>(`/products?${productParams}`);
  return products[0];
}

async function findPurchasableService(
  dolibarr: { get<T>(path: string): Promise<T> },
): Promise<DolibarrProduct | undefined> {
  const serviceParams = new URLSearchParams({
    mode: "2",
    limit: "1",
    sqlfilters: "(t.tobuy:=:1)",
  });
  const services = await dolibarr.get<DolibarrProduct[]>(`/products?${serviceParams}`);
  return services[0];
}

type ToolRegistrar = (server: McpServer) => void;
type RegisteredToolHandler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => CallToolResult | Promise<CallToolResult>;

interface TestMcpServer extends McpServer {
  _registeredTools: Record<string, {
    handler: RegisteredToolHandler;
    inputSchema?: { parseAsync(args: unknown): Promise<Record<string, unknown>> };
  }>;
}

async function callJsonTool<T = Record<string, unknown>>(
  registerTool: ToolRegistrar,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const server = new McpServer({ name: "dolibarr-mcp-integration-test", version: "0.1.0" });
  registerTool(server);

  const tool = (server as TestMcpServer)._registeredTools[toolName];
  assert.ok(tool, `Expected ${toolName} to be registered`);

  // Parse like the MCP server does so schema defaults apply to the handler args.
  const parsedArgs = tool.inputSchema ? await tool.inputSchema.parseAsync(args) : args;
  const result = await tool.handler(parsedArgs, {});
  const firstContent = result.content[0];
  assert.equal(firstContent?.type, "text");
  assert.equal(typeof firstContent.text, "string");

  const parsed = JSON.parse(firstContent.text) as unknown;
  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);
  return parsed as T;
}

function throwWithCleanupErrors(testError: unknown, cleanupErrors: unknown[]): void {
  if (testError !== undefined) {
    if (cleanupErrors.length > 0 && testError instanceof Error) {
      Object.assign(testError, { cleanupErrors });
    }
    throw testError;
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Failed to clean up Dolibarr integration test records.");
  }
}

test("creates, reads, and deletes a thirdparty in the real Dolibarr API", {
  skip: integrationTestSkipReason(),
}, async () => {
  const { createThirdparty, deleteThirdparty, getThirdparty, isDolibarrNotFoundError } = await loadApi();
  const name = uniqueName("Thirdparty");
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
    const cleanupErrors: unknown[] = [];
    await deleteThirdparty(id).catch((err: unknown) => cleanupErrors.push(err));
    throwWithCleanupErrors(undefined, cleanupErrors);
  }

  await assert.rejects(
    () => getThirdparty(id, { suppressErrorStatuses: [404] }),
    (err) => isDolibarrNotFoundError(err),
  );
});

test("creates and validates a proposal with an existing service line and a free-text line", {
  skip: integrationTestSkipReason(),
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
  const catalogService = await findActiveService(dolibarr);
  if (!catalogService) {
    t.skip("Dolibarr has no active service product available for the existing-service line.");
    return;
  }

  const clientName = uniqueName("Proposal Client");
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
    assert.equal(dolibarrDateFromTimestamp(proposal.date), "2026-05-19");
    assert.equal(
      dolibarrDateFromTimestamp(proposal.fin_validite),
      "2026-06-18",
    );
    assert.ok(Number(proposal.statut) > 0, `Expected validated proposal status, got ${proposal.statut}`);
    assert.ok((proposal.lines?.length ?? 0) >= 2);
    const catalogLine = proposal.lines?.find((line) => Number(line.fk_product) === Number(catalogService.id));
    assert.ok(catalogLine, `Expected proposal to include catalog service ${catalogService.ref}`);
    assert.equal(Number(catalogLine.subprice), Number(catalogService.price));
    assert.equal(Number(catalogLine.tva_tx), Number(catalogService.tva_tx));
  } catch (err) {
    testError = err;
  } finally {
    if (proposalId !== undefined) {
      await deleteProposal(proposalId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("creates, validates, reads, and deletes a client invoice in the real Dolibarr API", {
  skip: integrationTestSkipReason(),
}, async (t) => {
  const {
    DocumentCreationService,
    addInvoiceLine,
    createInvoice,
    createThirdparty,
    deleteInvoice,
    deleteThirdparty,
    dolibarr,
    getInvoice,
    registerGetInvoiceDetail,
    validateInvoice,
  } = await loadApi();
  const catalogService = await findActiveService(dolibarr);
  if (!catalogService) {
    t.skip("Dolibarr has no active service product available for the existing-service invoice line.");
    return;
  }

  const clientName = uniqueName("Invoice Client");
  const clientId = await createThirdparty({
    name: clientName,
    client: 1,
    supplier: 0,
    town: "Integration Test",
  });

  let invoiceId: number | undefined;
  let invoiceRef: string | undefined;
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const service = new DocumentCreationService({
      create: createInvoice,
      addLine: addInvoiceLine,
      validate: validateInvoice,
    });

    const result = await service.create({
      thirdparty: String(clientId),
      date: todayIsoDate(),
      validate: true,
      lines: [
        {
          product_ref: catalogService.ref,
          qty: 1,
        },
        {
          description: "Integration test free-text invoice line",
          qty: 2,
          unit_price: 42,
          vat_rate: 21,
        },
      ],
    });

    assert.equal("success" in result, true);
    if (!("success" in result)) {
      assert.fail(`Expected invoice creation success, got ${JSON.stringify(result)}`);
    }

    invoiceId = result.id;
    assert.equal(result.validated, true);
    assert.equal(result.lines.length, 2);
    assert.equal(result.lines[0].product_ref, catalogService.ref);
    assert.equal(result.lines[1].resolved, false);

    const invoice = await getInvoice(invoiceId);
    invoiceRef = invoice.ref;
    assert.equal(Number(invoice.id), invoiceId);
    assert.equal(Number(invoice.socid), clientId);
    assert.equal(dolibarrDateFromTimestamp(invoice.date), todayIsoDate());
    assert.ok(Number(invoice.statut) > 0, `Expected validated invoice status, got ${invoice.statut}`);
    assert.ok((invoice.lines?.length ?? 0) >= 2);

    const catalogLine = invoice.lines?.find((line) => Number(line.fk_product) === Number(catalogService.id));
    assert.ok(catalogLine, `Expected invoice to include catalog service ${catalogService.ref}`);
    assert.equal(Number(catalogLine.subprice), Number(catalogService.price));
    assert.equal(Number(catalogLine.tva_tx), Number(catalogService.tva_tx));

    const detailById = await callJsonTool(registerGetInvoiceDetail, "get_invoice_detail", {
      invoice: String(invoiceId),
    });
    assert.equal(detailById.id, invoiceId);
    assert.equal(detailById.ref, invoiceRef);
    assert.equal((detailById.client as Record<string, unknown>).id, clientId);
    assert.ok(
      (detailById.lines as Array<Record<string, unknown>>).some((line) => line.product_ref === catalogService.ref),
      `Expected get_invoice_detail by ID to include catalog service ${catalogService.ref}`,
    );

    const detailByRef = await callJsonTool(registerGetInvoiceDetail, "get_invoice_detail", {
      invoice: invoiceRef,
    });
    assert.equal(detailByRef.id, invoiceId);
    assert.equal(detailByRef.ref, invoiceRef);
  } catch (err) {
    testError = err;
  } finally {
    if (invoiceId !== undefined) {
      await deleteInvoice(invoiceId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("creates, validates, reads, and deletes a supplier invoice in the real Dolibarr API", {
  skip: integrationTestSkipReason(),
}, async () => {
  const {
    DocumentCreationService,
    addSupplierInvoiceLine,
    createSupplierInvoice,
    createThirdparty,
    deleteSupplierInvoice,
    deleteThirdparty,
    dolibarr,
    getSupplierInvoice,
    registerGetSupplierInvoiceDetail,
    validateSupplierInvoice,
  } = await loadApi();
  const catalogService = await findPurchasableService(dolibarr);
  const supplierInvoiceRef = uniqueRef("Supplier Invoice");
  const supplierName = uniqueName("Supplier Invoice Supplier");
  const supplierId = await createThirdparty({
    name: supplierName,
    client: 0,
    supplier: 1,
    town: "Integration Test",
  });

  let invoiceId: number | undefined;
  let invoiceRef: string | undefined;
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const service = new DocumentCreationService({
      create: createSupplierInvoice,
      addLine: addSupplierInvoiceLine,
      validate: validateSupplierInvoice,
    });

    const lines = [
      ...(catalogService ? [{
        product_ref: catalogService.ref,
        qty: 1,
      }] : []),
      {
        description: "Integration test free-text supplier invoice line",
        qty: 2,
        unit_price: 42,
        vat_rate: 21,
      },
    ];

    const result = await service.create({
      thirdparty: String(supplierId),
      refSupplier: supplierInvoiceRef,
      date: todayIsoDate(),
      validate: true,
      lines,
    });

    assert.equal("success" in result, true);
    if (!("success" in result)) {
      assert.fail(`Expected supplier invoice creation success, got ${JSON.stringify(result)}`);
    }

    invoiceId = result.id;
    assert.equal(result.validated, true);
    assert.equal(result.lines.length, lines.length);
    if (catalogService) {
      assert.equal(result.lines[0].product_ref, catalogService.ref);
    }
    assert.equal(result.lines.at(-1)?.resolved, false);

    const invoice = await getSupplierInvoice(invoiceId);
    invoiceRef = invoice.ref;
    assert.equal(Number(invoice.id), invoiceId);
    assert.equal(Number(invoice.socid), supplierId);
    assert.equal(dolibarrDateFromTimestamp(invoice.date), todayIsoDate());
    assert.ok(Number(invoice.statut) > 0, `Expected validated supplier invoice status, got ${invoice.statut}`);
    assert.ok((invoice.lines?.length ?? 0) >= lines.length);

    if (catalogService) {
      const catalogLine = invoice.lines?.find((line) => Number(line.fk_product) === Number(catalogService.id));
      assert.ok(catalogLine, `Expected supplier invoice to include catalog service ${catalogService.ref}`);
    }

    const detailById = await callJsonTool(registerGetSupplierInvoiceDetail, "get_supplier_invoice_detail", {
      supplier_invoice: String(invoiceId),
    });
    assert.equal(detailById.id, invoiceId);
    assert.equal(detailById.ref, invoiceRef);
    assert.equal(detailById.supplier_ref, supplierInvoiceRef);
    assert.equal((detailById.supplier as Record<string, unknown>).id, supplierId);
    assert.ok(
      (detailById.lines as Array<Record<string, unknown>>).some((line) => (
        String(line.description ?? line.label ?? "").includes("Integration test free-text supplier invoice line")
      )),
      "Expected get_supplier_invoice_detail by ID to include the free-text line",
    );

    const detailBySupplierRef = await callJsonTool(
      registerGetSupplierInvoiceDetail,
      "get_supplier_invoice_detail",
      { supplier_invoice: supplierInvoiceRef },
    );
    assert.equal(detailBySupplierRef.id, invoiceId);
    assert.equal(detailBySupplierRef.ref, invoiceRef);
    assert.equal(detailBySupplierRef.supplier_ref, supplierInvoiceRef);
  } catch (err) {
    testError = err;
  } finally {
    if (invoiceId !== undefined) {
      await deleteSupplierInvoice(invoiceId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(supplierId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("creates, validates, closes, and deletes a proposal in the real Dolibarr API", {
  skip: integrationTestSkipReason(),
}, async () => {
  const {
    DocumentCreationService,
    addProposalLine,
    createProposal,
    createThirdparty,
    deleteProposal,
    deleteThirdparty,
    getProposal,
    registerSetProposalStatus,
    validateProposal,
  } = await loadApi();
  const clientName = uniqueName("Proposal Status Client");
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
      date: todayIsoDate(),
      validate: true,
      lines: [{
        description: "Integration test free-text proposal status line",
        qty: 1,
        unit_price: 42,
        vat_rate: 21,
      }],
    });

    assert.equal("success" in result, true);
    if (!("success" in result)) {
      assert.fail(`Expected proposal creation success, got ${JSON.stringify(result)}`);
    }

    proposalId = result.id;
    assert.equal(result.validated, true);

    const validatedProposal = await getProposal(proposalId);
    assert.equal(Number(validatedProposal.id), proposalId);
    assert.equal(Number(validatedProposal.socid), clientId);
    assert.ok(Number(validatedProposal.statut) > 0, `Expected validated proposal status, got ${validatedProposal.statut}`);

    const statusResult = await callJsonTool(registerSetProposalStatus, "set_proposal_status", {
      proposal_id: proposalId,
      status: "refused",
      note: "Integration test closes this disposable proposal as refused.",
    });
    assert.equal(statusResult.success, true);
    assert.equal(statusResult.proposal_id, proposalId);
    assert.equal(statusResult.status, "refused");

    const closedProposal = await getProposal(proposalId);
    assert.equal(Number(closedProposal.id), proposalId);
    assert.equal(Number(closedProposal.statut), 3, `Expected refused proposal status, got ${closedProposal.statut}`);
  } catch (err) {
    testError = err;
  } finally {
    if (proposalId !== undefined) {
      await deleteProposal(proposalId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("searches catalog products through API helpers and MCP formatting", {
  skip: integrationTestSkipReason(),
}, async (t) => {
  const {
    dolibarr,
    registerSearchProducts,
    searchProducts,
  } = await loadApi();
  const catalogProduct = await findActiveProduct(dolibarr);
  if (!catalogProduct) {
    t.skip("Dolibarr has no active product available for product search coverage.");
    return;
  }

  const apiResults = await searchProducts(catalogProduct.ref);
  assert.ok(
    apiResults.some((product) => Number(product.id) === Number(catalogProduct.id)),
    `Expected searchProducts to find product ${catalogProduct.ref}`,
  );
  assert.ok(
    apiResults.every((product) => Number(product.type) === 0),
    "Expected searchProducts to return product rows only.",
  );

  const toolResults = await callJsonTool<Array<Record<string, unknown>>>(
    registerSearchProducts,
    "search_products",
    { query: catalogProduct.ref },
  );
  assert.ok(Array.isArray(toolResults));
  const formattedProduct = toolResults.find((product) => product.id === Number(catalogProduct.id));
  assert.ok(formattedProduct, `Expected search_products to format product ${catalogProduct.ref}`);
  assert.equal(formattedProduct.ref, catalogProduct.ref);
  assert.equal(formattedProduct.type, "product");
  assert.equal(typeof formattedProduct.price, "number");
});

test("searches catalog services through API helpers and MCP formatting", {
  skip: integrationTestSkipReason(),
}, async (t) => {
  const {
    dolibarr,
    registerSearchServices,
    searchServices,
  } = await loadApi();
  const catalogService = await findActiveService(dolibarr);
  if (!catalogService) {
    t.skip("Dolibarr has no active service available for service search coverage.");
    return;
  }

  const apiResults = await searchServices(catalogService.ref);
  assert.ok(
    apiResults.some((service) => Number(service.id) === Number(catalogService.id)),
    `Expected searchServices to find service ${catalogService.ref}`,
  );
  assert.ok(
    apiResults.every((service) => Number(service.type) === 1),
    "Expected searchServices to return service rows only.",
  );

  const toolResults = await callJsonTool<Array<Record<string, unknown>>>(
    registerSearchServices,
    "search_services",
    { query: catalogService.ref },
  );
  assert.ok(Array.isArray(toolResults));
  const formattedService = toolResults.find((service) => service.id === Number(catalogService.id));
  assert.ok(formattedService, `Expected search_services to format service ${catalogService.ref}`);
  assert.equal(formattedService.ref, catalogService.ref);
  assert.equal(formattedService.type, "service");
  assert.equal(typeof formattedService.price, "number");
});

test("searches disposable thirdparties through API helpers and MCP formatting", {
  skip: integrationTestSkipReason(),
}, async () => {
  const {
    createThirdparty,
    deleteThirdparty,
    registerSearchThirdparties,
    searchThirdparties,
  } = await loadApi();
  const searchToken = uniqueRef("Thirdparty Search");
  const clientName = `${integrationLabel("Search Client")} ${searchToken}`;
  const supplierName = `${integrationLabel("Search Supplier")} ${searchToken}`;
  const bothName = `${integrationLabel("Search Both")} ${searchToken}`;

  const clientId = await createThirdparty({
    name: clientName,
    client: 1,
    supplier: 0,
    email: `mcp-it-client-${Date.now()}@example.test`,
    town: "Integration Test",
  });
  const supplierId = await createThirdparty({
    name: supplierName,
    client: 0,
    supplier: 1,
    email: `mcp-it-supplier-${Date.now()}@example.test`,
    town: "Integration Test",
  });
  const bothId = await createThirdparty({
    name: bothName,
    client: 1,
    supplier: 1,
    email: `mcp-it-both-${Date.now()}@example.test`,
    town: "Integration Test",
  });

  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const allResults = await searchThirdparties(searchToken, "all");
    assert.ok(
      allResults.some((thirdparty) => Number(thirdparty.id) === clientId),
      `Expected searchThirdparties(all) to find client ${clientName}`,
    );
    assert.ok(
      allResults.some((thirdparty) => Number(thirdparty.id) === supplierId),
      `Expected searchThirdparties(all) to find supplier ${supplierName}`,
    );
    assert.ok(
      allResults.some((thirdparty) => Number(thirdparty.id) === bothId),
      `Expected searchThirdparties(all) to find client/supplier ${bothName}`,
    );

    const clientResults = await searchThirdparties(searchToken, "clients");
    assert.ok(
      clientResults.some((thirdparty) => Number(thirdparty.id) === clientId),
      `Expected searchThirdparties(clients) to find client ${clientName}`,
    );
    assert.ok(
      !clientResults.some((thirdparty) => Number(thirdparty.id) === supplierId),
      `Expected searchThirdparties(clients) to exclude supplier ${supplierName}`,
    );

    const supplierResults = await searchThirdparties(searchToken, "suppliers");
    assert.ok(
      supplierResults.some((thirdparty) => Number(thirdparty.id) === supplierId),
      `Expected searchThirdparties(suppliers) to find supplier ${supplierName}`,
    );
    assert.ok(
      !supplierResults.some((thirdparty) => Number(thirdparty.id) === clientId),
      `Expected searchThirdparties(suppliers) to exclude client ${clientName}`,
    );

    const formattedClients = await callJsonTool<Array<Record<string, unknown>>>(
      registerSearchThirdparties,
      "search_thirdparties",
      { query: searchToken, kind: "clients" },
    );
    assert.ok(Array.isArray(formattedClients));
    const formattedClient = formattedClients.find((thirdparty) => thirdparty.id === clientId);
    assert.ok(formattedClient, `Expected search_thirdparties to format client ${clientName}`);
    assert.equal(formattedClient.name, clientName);
    assert.equal(formattedClient.type, "client");
    assert.equal(formattedClient.is_client, true);
    assert.equal(formattedClient.is_supplier, false);

    const formattedSuppliers = await callJsonTool<Array<Record<string, unknown>>>(
      registerSearchThirdparties,
      "search_thirdparties",
      { query: searchToken, kind: "suppliers" },
    );
    assert.ok(Array.isArray(formattedSuppliers));
    const formattedSupplier = formattedSuppliers.find((thirdparty) => thirdparty.id === supplierId);
    assert.ok(formattedSupplier, `Expected search_thirdparties to format supplier ${supplierName}`);
    assert.equal(formattedSupplier.name, supplierName);
    assert.equal(formattedSupplier.type, "supplier");
    assert.equal(formattedSupplier.is_client, false);
    assert.equal(formattedSupplier.is_supplier, true);

    const formattedAll = await callJsonTool<Array<Record<string, unknown>>>(
      registerSearchThirdparties,
      "search_thirdparties",
      { query: searchToken, kind: "all" },
    );
    const formattedBoth = formattedAll.find((thirdparty) => thirdparty.id === bothId);
    assert.ok(formattedBoth, `Expected search_thirdparties to format client/supplier ${bothName}`);
    assert.equal(formattedBoth.name, bothName);
    assert.equal(formattedBoth.type, "both");
    assert.equal(formattedBoth.is_client, true);
    assert.equal(formattedBoth.is_supplier, true);
  } catch (err) {
    testError = err;
  } finally {
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
    await deleteThirdparty(supplierId).catch((err: unknown) => cleanupErrors.push(err));
    await deleteThirdparty(bothId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("reads client overview, receivables, monthly revenue, and cross-search from a disposable invoice", {
  skip: integrationTestSkipReason(),
}, async () => {
  const {
    DocumentCreationService,
    addInvoiceLine,
    createInvoice,
    createThirdparty,
    deleteInvoice,
    deleteThirdparty,
    getInvoice,
    registerGetClientOverview,
    registerGetMonthlyRevenue,
    registerGetOutstandingReceivables,
    registerSearchAcross,
    registerSearchDocumentContent,
    validateInvoice,
  } = await loadApi();
  const searchToken = uniqueRef("Read Tools");
  const clientName = `${integrationLabel("Read Tools Client")} ${searchToken}`;
  const invoiceDate = todayIsoDate();
  const [year, month] = invoiceDate.split("-").map(Number);
  const clientId = await createThirdparty({
    name: clientName,
    client: 1,
    supplier: 0,
    email: `mcp-it-read-tools-${Date.now()}@example.test`,
    town: "Integration Test",
  });

  let invoiceId: number | undefined;
  let invoiceRef: string | undefined;
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const service = new DocumentCreationService({
      create: createInvoice,
      addLine: addInvoiceLine,
      validate: validateInvoice,
    });
    const result = await service.create({
      thirdparty: String(clientId),
      date: invoiceDate,
      validate: true,
      lines: [{
        description: `Integration test read-tools invoice ${searchToken}`,
        qty: 1,
        unit_price: 123.45,
        vat_rate: 21,
      }],
    });

    assert.equal("success" in result, true);
    if (!("success" in result)) {
      assert.fail(`Expected read-tools invoice creation success, got ${JSON.stringify(result)}`);
    }

    invoiceId = result.id;
    assert.equal(result.validated, true);

    const invoice = await getInvoice(invoiceId);
    invoiceRef = invoice.ref;
    assert.equal(Number(invoice.id), invoiceId);
    assert.equal(Number(invoice.socid), clientId);
    assert.ok(Number(invoice.statut) > 0, `Expected validated invoice status, got ${invoice.statut}`);

    const clientOverview = await callJsonTool<Record<string, unknown>>(
      registerGetClientOverview,
      "get_client_overview",
      { client: String(clientId) },
    );
    assert.equal((clientOverview.client as Record<string, unknown>).id, clientId);
    assert.equal((clientOverview.client as Record<string, unknown>).name, clientName);
    const overviewOpenInvoices = clientOverview.open_invoices as Record<string, unknown>;
    assert.ok(Number(overviewOpenInvoices.count) >= 1);
    assert.ok(
      (overviewOpenInvoices.invoices as Array<Record<string, unknown>>).some((openInvoice) => openInvoice.id === invoiceId),
      `Expected get_client_overview to include invoice ${invoiceRef}`,
    );

    const receivables = await callJsonTool<Record<string, unknown>>(
      registerGetOutstandingReceivables,
      "get_outstanding_receivables",
      {},
    );
    assert.ok(Number(receivables.client_count) >= 1);
    assert.ok(Number(receivables.invoice_count) >= 1);
    assert.equal(typeof receivables.total_outstanding, "number");
    const receivableClient = (receivables.clients as Array<Record<string, unknown>>)
      .find((clientGroup) => (clientGroup.client as Record<string, unknown>).id === clientId);
    assert.ok(receivableClient, `Expected get_outstanding_receivables to include client ${clientName}`);
    assert.ok(
      (receivableClient.invoices as Array<Record<string, unknown>>).some((openInvoice) => openInvoice.id === invoiceId),
      `Expected get_outstanding_receivables to include invoice ${invoiceRef}`,
    );

    const monthlyRevenue = await callJsonTool<Record<string, unknown>>(
      registerGetMonthlyRevenue,
      "get_monthly_revenue",
      { year, month, include_invoices: true },
    );
    assert.deepEqual(monthlyRevenue.period, {
      year,
      month,
      start_date: `${invoiceDate.slice(0, 8)}01`,
      exclusive_end_date: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    });
    assert.ok(Number(monthlyRevenue.invoice_count) >= 1);
    assert.equal(typeof (monthlyRevenue.totals as Record<string, unknown>).total_including_tax, "number");
    assert.ok(
      (monthlyRevenue.invoices as Array<Record<string, unknown>>).some((monthlyInvoice) => monthlyInvoice.id === invoiceId),
      `Expected get_monthly_revenue to include invoice ${invoiceRef}`,
    );

    const searchAcross = await callJsonTool<Record<string, unknown>>(
      registerSearchAcross,
      "search_across",
      { query: searchToken },
    );
    assert.ok(
      (searchAcross.thirdparties as Array<Record<string, unknown>>).some((thirdparty) => thirdparty.id === clientId),
      `Expected search_across to include thirdparty ${clientName}`,
    );
    assert.ok(
      (searchAcross.invoices as Array<Record<string, unknown>>).some((foundInvoice) => foundInvoice.id === invoiceId),
      `Expected search_across to include invoice ${invoiceRef}`,
    );

    const contentSearch = await callJsonTool<Record<string, unknown>>(
      registerSearchDocumentContent,
      "search_document_content",
      {
        query: searchToken,
        max_documents_per_type: 10,
      },
    );
    assert.ok(
      (contentSearch.matches as Array<Record<string, unknown>>).some((match) => (
        match.document_id === invoiceId
        && match.document_ref === invoiceRef
        && match.thirdparty_name === clientName
        && typeof match.line_id === "number"
        && match.total_excluding_tax === 123.45
        && String(match.description).includes(searchToken)
      )),
      `Expected search_document_content to include line content from invoice ${invoiceRef}`,
    );
  } catch (err) {
    testError = err;
  } finally {
    if (invoiceId !== undefined) {
      await deleteInvoice(invoiceId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

type UpdateToolLine = {
  line_id: number;
  description?: string;
  qty?: number;
  unit_price?: number;
  vat_rate?: number;
  discount_percent?: number;
};

type UpdateToolResponse = {
  success?: boolean;
  error?: string;
  ref?: string;
  date?: string;
  valid_until?: string;
  supplier_invoice_ref?: string;
  changes?: { updated_fields: string[]; updated_line_ids: number[]; removed_line_ids: number[] };
  lines?: UpdateToolLine[];
};

// Two free-text lines: the first gets a qty-only edit, the second is removed,
// and a third is appended. The qty-only edit guards against Dolibarr resetting
// fields missing from a line PUT body.
const draftUpdateLines = [
  { description: "Integration update line A", qty: 2, unit_price: 100, vat_rate: 21, product_type: "service" as const },
  { description: "Integration update line B", qty: 1, unit_price: 10, vat_rate: 21, product_type: "service" as const },
];

function assertDraftLineUpdate(response: UpdateToolResponse, lineAId: number, lineBId: number): void {
  assert.equal(response.success, true, `Expected update success, got ${JSON.stringify(response)}`);
  assert.deepEqual(response.changes?.updated_line_ids, [lineAId]);
  assert.deepEqual(response.changes?.removed_line_ids, [lineBId]);

  const lines = response.lines ?? [];
  assert.equal(lines.length, 2);
  const lineA = lines.find((line) => line.line_id === lineAId);
  assert.ok(lineA, "Expected edited line A in the update response");
  assert.equal(lineA.description, "Integration update line A");
  assert.equal(lineA.qty, 3);
  assert.equal(lineA.unit_price, 100);
  assert.equal(lineA.vat_rate, 21);
  assert.equal(lineA.discount_percent, 5);
  assert.ok(!lines.some((line) => line.line_id === lineBId), "Expected line B to be removed");
  assert.ok(lines.some((line) => line.description === "Integration update line C"));
}

const draftUpdateLineEdits = (lineAId: number, lineBId: number) => ({
  update_lines: [{ line_id: lineAId, qty: 3 }],
  remove_line_ids: [lineBId],
  add_lines: [{ description: "Integration update line C", qty: 1, unit_price: 7.5, vat_rate: 21 }],
});

function sortedLineIds(lines: { id: number | string }[] | undefined): number[] {
  return (lines ?? []).map((line) => Number(line.id)).sort((a, b) => a - b);
}

test("updates a draft client invoice through update_invoice, then refuses once validated", {
  skip: integrationTestSkipReason(),
}, async () => {
  const {
    DocumentCreationService,
    addInvoiceLine,
    createInvoice,
    createThirdparty,
    deleteInvoice,
    deleteThirdparty,
    getInvoice,
    registerUpdateInvoice,
    updateInvoiceLine,
    validateInvoice,
  } = await loadApi();
  const clientId = await createThirdparty({
    name: uniqueName("Invoice Update Client"),
    client: 1,
    supplier: 0,
    town: "Integration Test",
  });

  let invoiceId: number | undefined;
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const service = new DocumentCreationService({ create: createInvoice, addLine: addInvoiceLine, validate: validateInvoice });
    const created = await service.create({ thirdparty: String(clientId), date: "2026-05-19", validate: false, lines: draftUpdateLines });
    if (!("success" in created)) assert.fail(`Expected invoice creation success, got ${JSON.stringify(created)}`);
    invoiceId = created.id;

    const [lineAId, lineBId] = sortedLineIds((await getInvoice(invoiceId)).lines);
    // Give line A a discount so the qty-only edit proves it survives.
    await updateInvoiceLine(invoiceId, lineAId, {
      desc: "Integration update line A",
      qty: 2,
      subprice: 100,
      tva_tx: 21,
      remise_percent: 5,
      product_type: 1,
    });

    const response = await callJsonTool<UpdateToolResponse>(registerUpdateInvoice, "update_invoice", {
      invoice: String(invoiceId),
      date: "2026-05-20",
      customer_ref: "MCP-IT-PO",
      note_private: "Integration update note",
      ...draftUpdateLineEdits(lineAId, lineBId),
    });
    assertDraftLineUpdate(response, lineAId, lineBId);
    assert.equal(response.date, "2026-05-20");

    const updated = (await getInvoice(invoiceId)) as Awaited<ReturnType<typeof getInvoice>> & Record<string, unknown>;
    assert.equal(dolibarrDateFromTimestamp(updated.date), "2026-05-20");
    assert.equal(updated.ref_client, "MCP-IT-PO");
    assert.equal(updated.note_private, "Integration update note");

    await validateInvoice(invoiceId);
    const refused = await callJsonTool<UpdateToolResponse>(registerUpdateInvoice, "update_invoice", {
      invoice: String(invoiceId),
      note_private: "Must not be written",
    });
    assert.equal(refused.error, "NOT_DRAFT");
    const afterRefusal = (await getInvoice(invoiceId)) as Awaited<ReturnType<typeof getInvoice>> & Record<string, unknown>;
    assert.equal(afterRefusal.note_private, "Integration update note");
  } catch (err) {
    testError = err;
  } finally {
    if (invoiceId !== undefined) {
      await deleteInvoice(invoiceId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("updates a draft supplier invoice through update_supplier_invoice, then refuses once validated", {
  skip: integrationTestSkipReason(),
}, async () => {
  const {
    DocumentCreationService,
    addSupplierInvoiceLine,
    createSupplierInvoice,
    createThirdparty,
    deleteSupplierInvoice,
    deleteThirdparty,
    getSupplierInvoice,
    registerUpdateSupplierInvoice,
    updateSupplierInvoiceLine,
    validateSupplierInvoice,
  } = await loadApi();
  const supplierId = await createThirdparty({
    name: uniqueName("Supplier Invoice Update Supplier"),
    client: 0,
    supplier: 1,
    town: "Integration Test",
  });

  let invoiceId: number | undefined;
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const service = new DocumentCreationService({
      create: createSupplierInvoice,
      addLine: addSupplierInvoiceLine,
      validate: validateSupplierInvoice,
    });
    const created = await service.create({
      thirdparty: String(supplierId),
      refSupplier: uniqueRef("Supplier Update"),
      date: "2026-05-19",
      validate: false,
      lines: draftUpdateLines,
    });
    if (!("success" in created)) assert.fail(`Expected supplier invoice creation success, got ${JSON.stringify(created)}`);
    invoiceId = created.id;

    const [lineAId, lineBId] = sortedLineIds((await getSupplierInvoice(invoiceId)).lines);
    await updateSupplierInvoiceLine(invoiceId, lineAId, {
      desc: "Integration update line A",
      qty: 2,
      subprice: 100,
      tva_tx: 21,
      remise_percent: 5,
      product_type: 1,
    });

    const newSupplierRef = uniqueRef("Supplier Update B");
    const response = await callJsonTool<UpdateToolResponse>(registerUpdateSupplierInvoice, "update_supplier_invoice", {
      supplier_invoice: String(invoiceId),
      date: "2026-05-21",
      supplier_invoice_ref: newSupplierRef,
      label: "Integration update label",
      ...draftUpdateLineEdits(lineAId, lineBId),
    });
    assertDraftLineUpdate(response, lineAId, lineBId);
    assert.equal(response.supplier_invoice_ref, newSupplierRef);
    assert.equal(response.date, "2026-05-21");

    const updated = (await getSupplierInvoice(invoiceId)) as Awaited<ReturnType<typeof getSupplierInvoice>> & Record<string, unknown>;
    assert.equal(updated.ref_supplier, newSupplierRef);
    assert.equal(updated.label, "Integration update label");

    await validateSupplierInvoice(invoiceId);
    const refused = await callJsonTool<UpdateToolResponse>(registerUpdateSupplierInvoice, "update_supplier_invoice", {
      supplier_invoice: String(invoiceId),
      update_lines: [{ line_id: lineAId, qty: 9 }],
    });
    assert.equal(refused.error, "NOT_DRAFT");
    const afterRefusal = await getSupplierInvoice(invoiceId);
    const lineAfterRefusal = afterRefusal.lines?.find((line) => Number(line.id) === lineAId);
    assert.equal(Number(lineAfterRefusal?.qty), 3);
  } catch (err) {
    testError = err;
  } finally {
    if (invoiceId !== undefined) {
      await deleteSupplierInvoice(invoiceId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(supplierId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("updates a draft proposal through update_proposal without moving its validity date", {
  skip: integrationTestSkipReason(),
}, async () => {
  const {
    DocumentCreationService,
    addProposalLine,
    createProposal,
    createThirdparty,
    deleteProposal,
    deleteThirdparty,
    getProposal,
    registerUpdateProposal,
    updateProposalLine,
    validateProposal,
  } = await loadApi();
  const clientId = await createThirdparty({
    name: uniqueName("Proposal Update Client"),
    client: 1,
    supplier: 0,
    town: "Integration Test",
  });

  let proposalId: number | undefined;
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const service = new DocumentCreationService({ create: createProposal, addLine: addProposalLine, validate: validateProposal });
    const created = await service.create({ thirdparty: String(clientId), date: "2026-05-19", validate: false, lines: draftUpdateLines });
    if (!("success" in created)) assert.fail(`Expected proposal creation success, got ${JSON.stringify(created)}`);
    proposalId = created.id;

    const [lineAId, lineBId] = sortedLineIds((await getProposal(proposalId)).lines);
    await updateProposalLine(proposalId, lineAId, { remise_percent: 5 });

    // A notes-only header update must keep the 30-day validity end date.
    const notesOnly = await callJsonTool<UpdateToolResponse>(registerUpdateProposal, "update_proposal", {
      proposal: String(proposalId),
      note_public: "Integration update note",
    });
    assert.equal(notesOnly.success, true, `Expected update success, got ${JSON.stringify(notesOnly)}`);
    assert.equal(notesOnly.valid_until, "2026-06-18");

    // Moving the date keeps the validity period.
    const moved = await callJsonTool<UpdateToolResponse>(registerUpdateProposal, "update_proposal", {
      proposal: String(proposalId),
      date: "2026-05-29",
      customer_ref: "MCP-IT-REF",
      ...draftUpdateLineEdits(lineAId, lineBId),
    });
    assertDraftLineUpdate(moved, lineAId, lineBId);
    assert.equal(moved.date, "2026-05-29");
    assert.equal(moved.valid_until, "2026-06-28");

    const extended = await callJsonTool<UpdateToolResponse>(registerUpdateProposal, "update_proposal", {
      proposal: String(proposalId),
      valid_until: "2026-07-31",
    });
    assert.equal(extended.valid_until, "2026-07-31");

    const beforeEnd = await callJsonTool<UpdateToolResponse>(registerUpdateProposal, "update_proposal", {
      proposal: String(proposalId),
      valid_until: "2026-05-01",
    });
    assert.equal(beforeEnd.error, "VALIDATION_ERROR");

    const updated = (await getProposal(proposalId)) as Awaited<ReturnType<typeof getProposal>> & Record<string, unknown>;
    assert.equal(updated.ref_client, "MCP-IT-REF");
    assert.equal(updated.note_public, "Integration update note");
    assert.equal(dolibarrDateFromTimestamp(updated.fin_validite), "2026-07-31");

    await validateProposal(proposalId);
    const refused = await callJsonTool<UpdateToolResponse>(registerUpdateProposal, "update_proposal", {
      proposal: String(proposalId),
      note_public: "Must not be written",
    });
    assert.equal(refused.error, "NOT_DRAFT");
  } catch (err) {
    testError = err;
  } finally {
    if (proposalId !== undefined) {
      await deleteProposal(proposalId).catch((err: unknown) => cleanupErrors.push(err));
    }
    await deleteThirdparty(clientId).catch((err: unknown) => cleanupErrors.push(err));
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

test("updates a disposable service and product through the catalog update tools", {
  skip: integrationTestSkipReason(),
}, async () => {
  const { dolibarr, registerSearchServices, registerUpdateProduct, registerUpdateService } = await loadApi();
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const serviceRef = `MCP-IT-SVC-${suffix}`;
  const productRef = `MCP-IT-PRD-${suffix}`;
  const createdIds: number[] = [];
  let testError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const serviceId = await dolibarr.post<number>("/products", {
      ref: serviceRef,
      label: integrationLabel("Catalog Service"),
      type: 1,
      price: 100,
      price_base_type: "HT",
      tva_tx: 21,
      status: 1,
      status_buy: 1,
    });
    createdIds.push(serviceId);
    const productId = await dolibarr.post<number>("/products", {
      ref: productRef,
      label: integrationLabel("Catalog Product"),
      type: 0,
      price: 10,
      price_base_type: "HT",
      tva_tx: 21,
      status: 1,
      status_buy: 1,
    });
    createdIds.push(productId);

    const renamedServiceRef = `${serviceRef}-B`;
    const updated = await callJsonTool<Record<string, unknown>>(registerUpdateService, "update_service", {
      service: serviceRef,
      ref: renamedServiceRef,
      label: integrationLabel("Catalog Service B"),
      description: "Integration catalog description",
      price: 120,
      vat_rate: 6,
      on_purchase: false,
    });
    assert.equal(updated.success, true, `Expected update success, got ${JSON.stringify(updated)}`);
    assert.equal(updated.service_id, serviceId);
    assert.equal("warnings" in updated, false, `Unexpected warnings ${JSON.stringify(updated.warnings)}`);
    assert.deepEqual(updated.service, {
      id: serviceId,
      ref: renamedServiceRef,
      label: integrationLabel("Catalog Service B"),
      price: 120,
      vat_rate: 6,
      type: "service",
      description: "Integration catalog description",
      price_including_tax: 127.2,
      on_sale: true,
      on_purchase: false,
    });

    const found = await callJsonTool<Record<string, unknown>[]>(registerSearchServices, "search_services", {
      query: renamedServiceRef,
    });
    const foundService = found.find((item) => item.id === serviceId);
    assert.ok(foundService, "Expected the renamed service in search_services results");
    assert.equal(foundService.price, 120);

    const labelOnly = await callJsonTool<Record<string, unknown>>(registerUpdateProduct, "update_product", {
      product: String(productId),
      label: integrationLabel("Catalog Product B"),
    });
    assert.equal(labelOnly.success, true, `Expected update success, got ${JSON.stringify(labelOnly)}`);
    const product = labelOnly.product as Record<string, unknown>;
    assert.equal(product.price, 10);
    assert.equal(product.vat_rate, 21);

    const duplicate = await callJsonTool<Record<string, unknown>>(registerUpdateProduct, "update_product", {
      product: productRef,
      ref: renamedServiceRef,
    });
    assert.equal(duplicate.error, "DUPLICATE_REF");

    const mismatch = await callJsonTool<Record<string, unknown>>(registerUpdateService, "update_service", {
      service: productRef,
      label: "Must not be written",
    });
    assert.equal(mismatch.error, "CATALOG_TYPE_MISMATCH");
    const unchanged = await dolibarr.get<{ label: string; type: string }>(`/products/${productId}`);
    assert.equal(unchanged.label, integrationLabel("Catalog Product B"));
    assert.equal(Number(unchanged.type), 0);
  } catch (err) {
    testError = err;
  } finally {
    for (const id of createdIds) {
      await dolibarr.delete(`/products/${id}`).catch((err: unknown) => cleanupErrors.push(err));
    }
  }

  throwWithCleanupErrors(testError, cleanupErrors);
});

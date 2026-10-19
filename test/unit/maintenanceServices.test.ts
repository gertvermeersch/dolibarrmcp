import assert from "node:assert/strict";
import test from "node:test";
import { get, withDolibarr } from "./helpers/dolibarrStub.js";

process.env.MCP_API_KEY ??= "unit-test";
process.env.DOLIBARR_URL ??= "http://localhost";
process.env.DOLIBARR_API_KEY ??= "unit-test";
process.env.DOLIBARR_TIMEZONE = "Europe/Brussels";

const { unixTimestampFromIsoDate: ts } = await import("../../src/tools/shared/normalization.js");
const { DolibarrApiError } = await import("../../src/dolibarr/errors.js");
const reads = await import("../../src/dolibarr/maintenance/contractReadService.js");
const { ContractCreationService } = await import("../../src/dolibarr/maintenance/contractCreationService.js");
const { RenewalInvoiceService } = await import("../../src/dolibarr/maintenance/renewalInvoiceService.js");
const { InterventionCreationService } = await import("../../src/dolibarr/maintenance/interventionCreationService.js");
const { ContractStatusService } = await import("../../src/dolibarr/maintenance/contractStatusService.js");

const today = "2026-06-15";

// Dolibarr returns numeric fields as strings; keep that shape in fixtures.
function contractLine(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    statut: "4",
    qty: "1",
    subprice: "1200.00000000",
    total_ht: "1200.00000000",
    tva_tx: "21.000",
    fk_product: "55",
    product_ref: "MAINT",
    product_label: "Maintenance",
    desc: "Maintenance plan",
    date_start: ts("2025-07-01"),
    date_end: ts("2026-06-30"),
    ...overrides,
  };
}

function contract(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ref: `CT-${id}`,
    socid: "7",
    date_contrat: ts("2025-07-01"),
    statut: "1",
    lines: [contractLine(id * 10)],
    ...overrides,
  } as never;
}

function invoice(id: number, date: string, overrides: Record<string, unknown> = {}) {
  return { id, ref: `FA-${id}`, socid: 7, date: ts(date), statut: 1, total_ht: 1200, total_ttc: 1452, ...overrides };
}

test("listContractsByExpiry returns expired and expiring contracts, earliest end first", async () => {
  const contracts = [
    contract(1, { lines: [contractLine(10, { date_end: ts("2026-07-20") })] }), // expiring, no renewal
    contract(2, { lines: [contractLine(20, { date_end: ts("2026-05-31") })] }), // expired, renewed
    contract(3, { lines: [contractLine(30, { date_end: ts("2027-06-30") })] }), // running, outside window
    contract(4, { statut: "0", lines: [contractLine(40, { statut: "0", date_end: ts("2026-06-20") })] }), // draft
    contract(5, { lines: [contractLine(50, { statut: "5", date_end: ts("2026-01-31") })] }), // closed
    contract(6, { lines: [contractLine(60, { date_start: "", date_end: "" })] }), // no end date
    contract(7, { lines: [contractLine(70, { date_end: ts("2026-06-15") })] }), // ends today
  ];
  const detail = (id: number) => ({
    ...contracts.find((c) => (c as { id: number }).id === id)!,
    linkedObjectsIds: id === 2 ? { facture: { "0": 91, "1": 92 } } : {},
  });

  await withDolibarr(
    [
      get(/^\/contracts$/, (_m, r) => (r.params.get("page") === "0" ? contracts : [])),
      get(/^\/contracts\/(\d+)$/, (m) => detail(Number(m[1]))),
      get(/^\/invoices\/91$/, invoice(91, "2025-07-05")), // initial invoice
      get(/^\/invoices\/92$/, invoice(92, "2026-05-20")), // renewal
    ],
    async (requests) => {
      const entries = await reads.listContractsByExpiry({ daysAhead: 60, includeExpired: true, today });

      assert.deepEqual(
        entries.map((entry) => [entry.contract.ref, entry.status, entry.daysUntilEnd, entry.renewalInvoiced]),
        [
          ["CT-2", "expired", -15, true],
          ["CT-7", "expiring", 0, false],
          ["CT-1", "expiring", 35, false],
        ],
      );

      const listRequest = requests.find((r) => r.path === "/contracts")!;
      assert.equal(listRequest.params.get("withLines"), "true");
      assert.equal(listRequest.params.has("thirdparty_ids"), false);
    },
  );

  await withDolibarr(
    [
      get(/^\/contracts$/, (_m, r) => (r.params.get("page") === "0" ? contracts : [])),
      get(/^\/contracts\/(\d+)$/, (m) => detail(Number(m[1]))),
      get(/^\/invoices\/(\d+)$/, (m) => (m[1] === "91" ? invoice(91, "2025-07-05") : invoice(92, "2026-05-20"))),
    ],
    async () => {
      const withoutExpired = await reads.listContractsByExpiry({ daysAhead: 60, includeExpired: false, today });
      assert.deepEqual(withoutExpired.map((entry) => entry.contract.ref), ["CT-7", "CT-1"]);

      const withoutRenewal = await reads.listContractsByExpiry({
        daysAhead: 60,
        includeExpired: true,
        onlyWithoutRenewal: true,
        today,
      });
      assert.deepEqual(withoutRenewal.map((entry) => entry.contract.ref), ["CT-7", "CT-1"]);

      const narrow = await reads.listContractsByExpiry({ daysAhead: 10, includeExpired: true, today });
      assert.deepEqual(narrow.map((entry) => entry.contract.ref), ["CT-2", "CT-7"]);
    },
  );
});

test("listContractsByExpiry filters by thirdparty and pages through all contracts", async () => {
  const page = (n: number) => Array.from({ length: 100 }, (_, i) => contract(n * 100 + i + 1, {
    lines: [contractLine(1, { date_end: ts("2030-01-01") })],
  }));

  await withDolibarr(
    [
      get(/^\/contracts$/, (_m, r) => {
        const index = Number(r.params.get("page"));
        return index < 2 ? page(index) : [contract(999, { lines: [contractLine(1, { date_end: ts("2026-07-01") })] })];
      }),
      get(/^\/contracts\/999$/, { ...(contract(999, { lines: [contractLine(1, { date_end: ts("2026-07-01") })] }) as object), linkedObjectsIds: {} }),
    ],
    async (requests) => {
      const entries = await reads.listContractsByExpiry({ daysAhead: 60, includeExpired: true, thirdpartyId: 7, today });

      assert.deepEqual(entries.map((entry) => entry.contract.ref), ["CT-999"]);
      const pages = requests.filter((r) => r.path === "/contracts").map((r) => r.params.get("page"));
      assert.deepEqual(pages, ["0", "1", "2"], "a full page triggers the next request, a short page stops");
      assert.ok(requests.filter((r) => r.path === "/contracts").every((r) => r.params.get("thirdparty_ids") === "7"));
    },
  );
});

function intervention(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ref: `FI-${id}`,
    socid: "7",
    fk_contrat: "1",
    statut: "3",
    description: "Visit",
    duration: "3600",
    lines: [{ id, date: ts("2026-03-10"), duration: "3600" }],
    ...overrides,
  };
}

test("queryInterventions filters by status and date and sorts most recent first", async () => {
  const interventions = [
    intervention(1, { lines: [{ id: 1, date: ts("2025-01-10"), duration: 3600 }] }),
    intervention(2, { lines: [{ id: 2, date: ts("2026-03-10"), duration: 3600 }] }),
    intervention(3, { statut: "1", lines: [{ id: 3, date: ts("2026-04-10"), duration: 3600 }] }),
    intervention(4, { lines: [{ id: 4, date: ts("2026-05-10"), duration: 3600 }] }),
  ];

  await withDolibarr(
    [get(/^\/interventions$/, (_m, r) => (r.params.get("page") === "0" ? interventions : []))],
    async (requests) => {
      const all = await reads.queryInterventions({ contractId: 1 });
      assert.deepEqual(all.map((i) => i.id), [4, 3, 2, 1]);
      const listRequest = requests.find((r) => r.path === "/interventions")!;
      assert.equal(listRequest.params.get("sqlfilters"), "(t.fk_contrat:=:1)");

      const done = await reads.queryInterventions({ status: reads.INTERVENTION_STATUS_DONE });
      assert.deepEqual(done.map((i) => i.id), [4, 2, 1]);

      const ranged = await reads.queryInterventions({ from: "2026-01-01", to: "2026-04-30", status: 3 });
      assert.deepEqual(ranged.map((i) => i.id), [2]);
    },
  );
});

test("loadMaintenanceOverview flags contracts without a done visit in the last 12 months", async () => {
  const contracts = [
    contract(1), // visited recently
    contract(2), // last visit too long ago
    contract(3), // never visited
    contract(4, { lines: [contractLine(40, { statut: "5" })] }), // closed: only counted
    contract(5), // only an open (not done) visit
  ];
  const interventions = [
    intervention(1, { fk_contrat: "1", lines: [{ id: 1, date: ts("2025-12-01"), duration: 3600 }] }),
    intervention(2, { fk_contrat: "1", lines: [{ id: 2, date: ts("2026-02-01"), duration: 5400 }] }),
    intervention(3, { fk_contrat: "2", lines: [{ id: 3, date: ts("2025-03-01"), duration: 3600 }] }),
    intervention(4, { fk_contrat: "5", statut: "1", lines: [{ id: 4, date: ts("2026-05-01"), duration: 3600 }] }),
  ];

  await withDolibarr(
    [
      get(/^\/contracts$/, (_m, r) => (r.params.get("page") === "0" ? contracts : [])),
      get(/^\/interventions$/, (_m, r) => (r.params.get("page") === "0" ? interventions : [])),
    ],
    async (requests) => {
      const overview = await reads.loadMaintenanceOverview(7, today);

      assert.equal(overview.lookbackFrom, "2025-06-15");
      assert.equal(overview.inactiveContractCount, 1);
      assert.deepEqual(
        overview.contracts.map((entry) => [
          entry.contract.ref,
          entry.lastDone?.ref,
          entry.lastDoneDate,
          entry.noMaintenanceInLookback,
        ]),
        [
          ["CT-1", "FI-2", "2026-02-01", false],
          ["CT-2", "FI-3", "2025-03-01", true],
          ["CT-3", undefined, undefined, true],
          ["CT-5", undefined, undefined, true],
        ],
      );
      assert.ok(requests.filter((r) => r.path === "/contracts").every((r) => r.params.get("thirdparty_ids") === "7"));
      assert.ok(requests.filter((r) => r.path === "/interventions").every((r) => r.params.get("thirdparty_ids") === "7"));
    },
  );
});

test("loadContractDetail combines linked invoices with interventions of the contract", async () => {
  const detail = { ...(contract(1) as object), linkedObjectsIds: { facture: { "0": 91 } } };

  await withDolibarr(
    [
      get(/^\/invoices\/91$/, invoice(91, "2025-07-05")),
      get(/^\/interventions$/, (_m, r) => (r.params.get("page") === "0" ? [intervention(1)] : [])),
    ],
    async () => {
      const bundle = await reads.loadContractDetail(detail as never);
      assert.deepEqual(bundle.invoices.map((i) => i.id), [91]);
      assert.deepEqual(bundle.interventions.map((i) => i.id), [1]);
    },
  );
});

// --- write services -------------------------------------------------------

test("create contract resolves services, validates, then activates every line", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const service = new ContractCreationService({
    resolveThirdparty: async () => ({ ok: true, id: 7, name: "Acme" }),
    resolveLine: async (input, index) => ({
      ok: true,
      resolved: {
        line: { fk_product: 55 + index, qty: input.qty, subprice: 100 * index, tva_tx: 21 },
        resolution: { index, resolved: true, product_ref: input.product_ref, label: `Service ${index}` },
      },
    }),
    commercialId: async () => 3,
    createContract: async (data) => {
      calls.push(["create", data]);
      return 42;
    },
    addContractLine: async (id, line) => {
      calls.push(["addLine", id, line]);
      return 400 + calls.length;
    },
    validateContract: async (id) => {
      calls.push(["validate", id]);
    },
    activateContractLine: async (id, lineId, data) => {
      calls.push(["activate", id, lineId, data]);
    },
    getContract: async () => contract(42, {
      ref: "CT2601-0001",
      lines: [contractLine(402), contractLine(403)],
    }),
  });

  const result = await service.create({
    thirdparty: "Acme",
    startDate: "2026-01-01",
    months: 12,
    services: [{ product_ref: "A", qty: 1 }, { product_ref: "B", qty: 2 }],
  });

  assert.ok("success" in result && result.success);
  assert.equal(result.id, 42);
  assert.equal(result.ref, "CT2601-0001");
  assert.equal(result.endDate, "2026-12-31");
  assert.deepEqual(result.warnings, []);

  const start = ts("2026-01-01");
  const end = ts("2026-12-31");
  assert.deepEqual(calls, [
    ["create", { socid: 7, date_contrat: start, commercial_signature_id: 3, commercial_suivi_id: 3 }],
    ["addLine", 42, { desc: "Service 1", qty: 1, subprice: 100, tva_tx: 21, fk_product: 56, date_start: start, date_end: end }],
    ["addLine", 42, { desc: "Service 2", qty: 2, subprice: 200, tva_tx: 21, fk_product: 57, date_start: start, date_end: end }],
    ["validate", 42],
    ["activate", 42, 402, { datestart: start, dateend: end, comment: "Activated by create_contract" }],
    ["activate", 42, 403, { datestart: start, dateend: end, comment: "Activated by create_contract" }],
  ]);
});

test("create contract validates input before the first write", async () => {
  let writes = 0;
  const base = {
    resolveThirdparty: async () => ({ ok: true as const, id: 7, name: "Acme" }),
    commercialId: async () => 3,
    createContract: async () => {
      writes++;
      return 1;
    },
  };
  const input = { thirdparty: "Acme", startDate: "2026-01-01", months: 12, services: [{ product_ref: "X", qty: 1 }] };

  const badDate = await new ContractCreationService(base).create({ ...input, startDate: "2026-02-30" });
  assert.equal((badDate as { error: string }).error, "VALIDATION_ERROR");

  const unknownService = await new ContractCreationService({
    ...base,
    resolveLine: async (_input, index) => ({ ok: false, error: { index, error: "Line 1: not found" } }),
  }).create(input);
  assert.equal((unknownService as { error: string }).error, "VALIDATION_ERROR");
  assert.deepEqual((unknownService as { line_errors: unknown[] }).line_errors, [{ index: 1, error: "Line 1: not found" }]);

  const noCommercial = await new ContractCreationService({
    ...base,
    commercialId: async () => undefined,
    resolveLine: async (i, index) => ({
      ok: true,
      resolved: { line: { qty: i.qty }, resolution: { index, resolved: true, label: "S" } },
    }),
  }).create(input);
  assert.equal((noCommercial as { error: string }).error, "VALIDATION_ERROR");
  assert.match((noCommercial as { action: string }).action, /DOLIBARR_DEFAULT_COMMERCIAL_ID/);

  const ambiguous = await new ContractCreationService({
    ...base,
    resolveThirdparty: async () => ({ ok: false, error: { error: "THIRDPARTY_AMBIGUOUS", message: "many" } }),
  }).create(input);
  assert.equal((ambiguous as { error: string }).error, "THIRDPARTY_AMBIGUOUS");

  assert.equal(writes, 0);
});

test("create contract reports a partial failure with the contract ID and deletes nothing", async () => {
  const service = new ContractCreationService({
    resolveThirdparty: async () => ({ ok: true, id: 7, name: "Acme" }),
    resolveLine: async (input, index) => ({
      ok: true,
      resolved: {
        line: { qty: input.qty, subprice: 100, tva_tx: 21 },
        resolution: { index, resolved: true, label: "Service" },
      },
    }),
    commercialId: async () => 3,
    createContract: async () => 42,
    addContractLine: async () => 401,
    validateContract: async () => {
      throw new DolibarrApiError(500, "boom", "/contracts/42/validate");
    },
  });

  const result = await service.create({
    thirdparty: "Acme",
    startDate: "2026-01-01",
    months: 12,
    services: [{ product_ref: "A", qty: 1 }],
  });

  assert.equal((result as { error: string }).error, "DOLIBARR_API_ERROR");
  assert.equal((result as { contract_id: number }).contract_id, 42);
  assert.equal((result as { failed_step: string }).failed_step, "validate contract");
});

function renewalDeps(overrides: Record<string, unknown> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const deps = {
    createInvoice: async (data: unknown) => {
      calls.push(["createInvoice", data]);
      return 91;
    },
    addInvoiceLine: async (id: number, line: unknown) => {
      calls.push(["addLine", id, line]);
      return 1;
    },
    validateInvoice: async (id: number) => {
      calls.push(["validate", id]);
    },
    getContract: async () => ({ ...(contract(1) as object), linkedObjectsIds: { facture: { "0": 91 } } }) as never,
    withLinkedInvoices: async (c: never) => ({ contract: c, invoices: [] as never[] }),
    today: () => today,
    ...overrides,
  };
  return { deps: deps as never, calls };
}

test("renewal invoice covers the next period and links the contract", async () => {
  const { deps, calls } = renewalDeps();
  const result = await new RenewalInvoiceService(deps).create({
    contract: contract(1),
    allowDuplicate: false,
    validate: false,
  });

  assert.ok("success" in result && result.success);
  assert.deepEqual(result.period, { start: "2026-07-01", end: "2027-06-30", months: 12 });
  assert.equal(result.linkedToContract, true);
  assert.equal(result.totalExcludingTax, 1200);

  assert.deepEqual(calls[0], [
    "createInvoice",
    { socid: 7, date: ts(today), linked_objects: { contrat: 1 } },
  ]);
  assert.deepEqual(calls[1], [
    "addLine",
    91,
    {
      fk_product: 55,
      desc: "Maintenance plan\nPeriode: 01/07/2026 t/m 30/06/2027",
      qty: 1,
      subprice: 1200,
      tva_tx: 21,
      remise_percent: 0,
      product_type: 1,
      date_start: ts("2026-07-01"),
      date_end: ts("2027-06-30"),
    },
  ]);
  assert.equal(calls.length, 2, "no validation unless asked for");
});

test("renewal invoice honours invoice date, due date, period length and validation", async () => {
  const { deps, calls } = renewalDeps();
  const result = await new RenewalInvoiceService(deps).create({
    contract: contract(1),
    date: "2026-06-01",
    dueDate: "2026-07-01",
    months: 6,
    allowDuplicate: false,
    validate: true,
  });

  assert.ok("success" in result && result.success);
  assert.deepEqual(result.period, { start: "2026-07-01", end: "2026-12-31", months: 6 });
  assert.deepEqual(calls[0][1], {
    socid: 7,
    date: ts("2026-06-01"),
    date_lim_reglement: ts("2026-07-01"),
    linked_objects: { contrat: 1 },
  });
  assert.deepEqual(calls.at(-1), ["validate", 91]);
});

test("renewal invoice refuses a second renewal unless allow_duplicate is set", async () => {
  const existing = invoice(80, "2026-05-20") as never;
  const { deps, calls } = renewalDeps({
    withLinkedInvoices: async (c: never) => ({ contract: c, invoices: [existing] }),
  });
  const service = new RenewalInvoiceService(deps);

  const refused = await service.create({ contract: contract(1), allowDuplicate: false, validate: false });
  assert.equal((refused as { error: string }).error, "RENEWAL_ALREADY_INVOICED");
  assert.deepEqual((refused as { invoice_ids: number[] }).invoice_ids, [80]);
  assert.equal(calls.length, 0);

  const allowed = await service.create({ contract: contract(1), allowDuplicate: true, validate: false });
  assert.ok("success" in allowed && allowed.success);
  assert.deepEqual(allowed.existingRenewalInvoiceIds, [80]);
});

test("renewal invoice rejects contracts that cannot be renewed", async () => {
  const { deps, calls } = renewalDeps();
  const service = new RenewalInvoiceService(deps);

  const closed = await service.create({
    contract: contract(1, { lines: [contractLine(10, { statut: "5" })] }),
    allowDuplicate: false,
    validate: false,
  });
  assert.equal((closed as { error: string }).error, "VALIDATION_ERROR");

  const noEnd = await service.create({
    contract: contract(1, { lines: [contractLine(10, { date_end: "" })] }),
    allowDuplicate: false,
    validate: false,
  });
  assert.equal((noEnd as { error: string }).error, "VALIDATION_ERROR");

  const badDue = await service.create({
    contract: contract(1),
    date: "2026-06-10",
    dueDate: "2026-06-01",
    allowDuplicate: false,
    validate: false,
  });
  assert.equal((badDue as { error: string }).error, "VALIDATION_ERROR");

  assert.equal(calls.length, 0);
});

test("renewal invoice warns when Dolibarr did not link the invoice", async () => {
  const { deps } = renewalDeps({ getContract: async () => ({ ...(contract(1) as object), linkedObjectsIds: {} }) });
  const result = await new RenewalInvoiceService(deps).create({
    contract: contract(1),
    allowDuplicate: false,
    validate: false,
  });

  assert.ok("success" in result && result.success);
  assert.equal(result.linkedToContract, false);
});

test("renewal invoice reports a partial failure with the invoice ID", async () => {
  const { deps } = renewalDeps({
    addInvoiceLine: async () => {
      throw new DolibarrApiError(400, "bad line", "/invoices/91/lines");
    },
  });
  const result = await new RenewalInvoiceService(deps).create({
    contract: contract(1),
    allowDuplicate: false,
    validate: false,
  });

  assert.equal((result as { invoice_id: number }).invoice_id, 91);
  assert.equal((result as { failed_step: string }).failed_step, "add lines");
});

function interventionDeps() {
  const calls: Array<[string, ...unknown[]]> = [];
  const deps = {
    createIntervention: async (data: unknown) => {
      calls.push(["create", data]);
      return 61;
    },
    addInterventionLine: async (id: number, line: unknown) => {
      calls.push(["addLine", id, line]);
      return 1;
    },
    validateIntervention: async (id: number) => {
      calls.push(["validate", id]);
    },
    closeIntervention: async (id: number) => {
      calls.push(["close", id]);
    },
    getIntervention: async () => intervention(61) as never,
  };
  return { deps: deps as never, calls };
}

test("create intervention links the contract, converts hours and closes by default", async () => {
  const { deps, calls } = interventionDeps();
  const result = await new InterventionCreationService(deps).create({
    contract: contract(1),
    date: "2026-06-10",
    durationHours: 1.5,
    description: "Updated plugins",
    close: true,
  });

  assert.ok("success" in result && result.success);
  assert.deepEqual(calls, [
    ["create", { socid: 7, fk_project: 0, description: "Updated plugins", fk_contrat: 1 }],
    ["addLine", 61, { description: "Updated plugins", date: ts("2026-06-10"), duration: 5400 }],
    ["validate", 61],
    ["close", 61],
  ]);
});

test("create intervention without close stays validated, and rejects bad input first", async () => {
  const { deps, calls } = interventionDeps();
  const service = new InterventionCreationService(deps);

  const open = await service.create({
    contract: contract(1),
    date: "2026-06-10",
    durationHours: 2,
    description: "Visit",
    close: false,
  });
  assert.ok("success" in open && open.success);
  assert.deepEqual(calls.map(([step]) => step), ["create", "addLine", "validate"]);

  const before = calls.length;
  const badDate = await service.create({ contract: contract(1), date: "10-06-2026", durationHours: 1, description: "x", close: true });
  const badDuration = await service.create({ contract: contract(1), date: "2026-06-10", durationHours: 0, description: "x", close: true });
  assert.equal((badDate as { error: string }).error, "VALIDATION_ERROR");
  assert.equal((badDuration as { error: string }).error, "VALIDATION_ERROR");
  assert.equal(calls.length, before);
});

function statusDeps(refreshed: unknown) {
  const calls: Array<[string, ...unknown[]]> = [];
  const deps = {
    closeContract: async (id: number) => {
      calls.push(["close", id]);
    },
    unactivateContractLine: async (id: number, lineId: number, data: unknown) => {
      calls.push(["unactivate", id, lineId, data]);
    },
    getContract: async () => refreshed as never,
    today: () => today,
  };
  return { deps: deps as never, calls };
}

test("set_contract_status closes an open contract and is idempotent", async () => {
  const open = contract(1, { lines: [contractLine(10), contractLine(11, { statut: "5" })] });
  const { deps, calls } = statusDeps(contract(1, { statut: "2", lines: [contractLine(10, { statut: "5" })] }));
  const service = new ContractStatusService(deps);

  const closed = await service.set(open, { status: "closed" });
  assert.ok("success" in closed && closed.success);
  assert.deepEqual(calls, [["close", 1]]);
  assert.deepEqual(closed.closedLineIds, [10]);
  assert.equal(closed.openLineCount, 0);

  const again = await service.set(contract(1, { lines: [contractLine(10, { statut: "5" })] }), { status: "closed" });
  assert.ok("success" in again && again.success);
  assert.equal(again.note, "Already closed.");
  assert.equal(calls.length, 1, "no second close call");
});

test("set_contract_status treats Dolibarr's 304 on close as already closed", async () => {
  const { deps } = statusDeps(contract(1));
  const service = new ContractStatusService({
    ...(deps as object),
    closeContract: async () => {
      throw new DolibarrApiError(304, "nothing done", "/contracts/1/close");
    },
  } as never);

  const result = await service.set(contract(1), { status: "closed" });
  assert.ok("success" in result && result.success);
  assert.equal(result.note, "Already closed.");
});

test("set_contract_status refuses to close a draft contract", async () => {
  const { deps, calls } = statusDeps(contract(1));
  const result = await new ContractStatusService(deps).set(
    contract(1, { statut: "0", lines: [contractLine(10, { statut: "0" })] }),
    { status: "closed" },
  );

  assert.equal((result as { error: string }).error, "VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("set_contract_status deactivates the requested lines and skips closed ones", async () => {
  const lines = [contractLine(10), contractLine(11), contractLine(12, { statut: "5" })];
  const { deps, calls } = statusDeps(contract(1, { lines }));
  const service = new ContractStatusService(deps);

  const result = await service.set(contract(1, { lines }), {
    status: "lines_deactivated",
    lineIds: [11, 12],
    date: "2026-06-30",
    comment: "Customer left",
  });

  assert.ok("success" in result && result.success);
  assert.deepEqual(calls, [["unactivate", 1, 11, { datestart: ts("2026-06-30"), comment: "Customer left" }]]);
  assert.deepEqual(result.closedLineIds, [11]);
  assert.deepEqual(result.skippedLineIds, [12]);

  calls.length = 0;
  const all = await service.set(contract(1, { lines }), { status: "lines_deactivated" });
  assert.ok("success" in all && all.success);
  assert.deepEqual(calls.map((c) => c[2]), [10, 11]);
  assert.deepEqual(calls[0][3], { datestart: ts(today) });
});

test("set_contract_status rejects line IDs from another contract before writing", async () => {
  const { deps, calls } = statusDeps(contract(1));
  const result = await new ContractStatusService(deps).set(contract(1), {
    status: "lines_deactivated",
    lineIds: [10, 999],
  });

  assert.equal((result as { error: string }).error, "VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

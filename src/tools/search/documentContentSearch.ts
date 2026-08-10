import { DolibarrApiError } from "../../dolibarr/errors.js";
import { cleanString, dolibarrId, money, numberOrUndefined } from "../shared/normalization.js";
import type {
  DolibarrInvoiceLine,
  DolibarrOrder,
  DolibarrThirdparty,
} from "../../types/dolibarr.js";

export const documentContentTypes = [
  "proposal",
  "order",
  "client_invoice",
  "supplier_invoice",
] as const;

export type DocumentContentType = typeof documentContentTypes[number];

type DocumentWithLines = Pick<DolibarrOrder, "id" | "ref" | "socid" | "lines">;

export type DocumentContentSearchDependencies = {
  domains: Record<DocumentContentType, {
    list: (limit: number) => Promise<DocumentWithLines[]>;
    get: (id: number) => Promise<DocumentWithLines>;
  }>;
  getThirdparty: (id: number) => Promise<DolibarrThirdparty>;
};

export type DocumentContentSearchOptions = {
  query: string;
  documentTypes?: DocumentContentType[];
  maxDocumentsPerType?: number;
  limit?: number;
  concurrency?: number;
};

type PendingMatch = {
  document_type: DocumentContentType;
  document_id: number;
  document_ref?: string;
  thirdparty_id?: number;
  line_id: number;
  product_ref?: string;
  description: string;
  total_excluding_tax?: number;
};

type ScanSummary = {
  available: boolean;
  documents_considered: number;
  documents_fetched: number;
  matched_lines: number;
  more_documents_available: boolean;
};

const defaultMaxDocumentsPerType = 25;
const defaultResultLimit = 50;
const defaultConcurrency = 5;

type RunLimited = <T>(task: () => Promise<T>) => Promise<T>;

function isUnavailable(err: unknown): boolean {
  return err instanceof DolibarrApiError && (err.status === 403 || err.status === 404);
}

function lineDescription(line: DolibarrInvoiceLine): string | undefined {
  const raw = line as DolibarrInvoiceLine & Record<string, unknown>;
  return cleanString(line.desc ?? raw.description);
}

function lineProductRef(line: DolibarrInvoiceLine): string | undefined {
  const raw = line as DolibarrInvoiceLine & Record<string, unknown>;
  return cleanString(line.product_ref ?? raw.productRef ?? raw.ref_product);
}

function createLimiter(
  concurrency: number,
): RunLimited {
  let active = 0;
  const queue: Array<() => void> = [];

  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const run = (): void => {
      active += 1;
      task().then(resolve, reject).finally(() => {
        active -= 1;
        queue.shift()?.();
      });
    };

    if (active < concurrency) run();
    else queue.push(run);
  });
}

async function scanDomain(
  type: DocumentContentType,
  query: string,
  maxDocuments: number,
  runLimited: RunLimited,
  dependencies: DocumentContentSearchDependencies,
): Promise<{ matches: PendingMatch[]; summary: ScanSummary }> {
  try {
    // Ask for one extra header so the response can say whether the bounded scan
    // omitted older documents. Dolibarr list sqlfilters apply to the document
    // table alias and cannot safely filter joined line descriptions.
    const listed = await runLimited(() => dependencies.domains[type].list(maxDocuments + 1));
    const documents = listed.slice(0, maxDocuments);
    const fetched = await Promise.all(documents.map((document) => runLimited(async () => {
      try {
        return await dependencies.domains[type].get(dolibarrId(document.id));
      } catch (err) {
        // A document can disappear between list and detail calls.
        if (err instanceof DolibarrApiError && err.status === 404) return undefined;
        throw err;
      }
    })));

    const matches: PendingMatch[] = [];
    for (const document of fetched) {
      if (!document) continue;
      for (const line of document.lines ?? []) {
        const description = lineDescription(line);
        const lineId = numberOrUndefined(line.id);
        if (!description || lineId === undefined || !description.toLocaleLowerCase().includes(query)) {
          continue;
        }

        matches.push({
          document_type: type,
          document_id: dolibarrId(document.id),
          document_ref: cleanString(document.ref),
          thirdparty_id: numberOrUndefined(document.socid),
          line_id: lineId,
          product_ref: lineProductRef(line),
          description,
          total_excluding_tax: money(line.total_ht),
        });
      }
    }

    return {
      matches,
      summary: {
        available: true,
        documents_considered: documents.length,
        documents_fetched: fetched.filter(Boolean).length,
        matched_lines: matches.length,
        more_documents_available: listed.length > maxDocuments,
      },
    };
  } catch (err) {
    if (!isUnavailable(err)) throw err;
    return {
      matches: [],
      summary: {
        available: false,
        documents_considered: 0,
        documents_fetched: 0,
        matched_lines: 0,
        more_documents_available: false,
      },
    };
  }
}

export async function searchDocumentContent(
  options: DocumentContentSearchOptions,
  dependencies: DocumentContentSearchDependencies,
): Promise<Record<string, unknown>> {
  const normalizedQuery = options.query.trim().toLocaleLowerCase();
  const documentTypes = options.documentTypes ?? [...documentContentTypes];
  const maxDocuments = options.maxDocumentsPerType ?? defaultMaxDocumentsPerType;
  const resultLimit = options.limit ?? defaultResultLimit;
  const concurrency = Math.max(1, options.concurrency ?? defaultConcurrency);
  const runLimited = createLimiter(concurrency);

  const scans = await Promise.all(
    documentTypes.map((type) => scanDomain(
      type,
      normalizedQuery,
      maxDocuments,
      runLimited,
      dependencies,
    )),
  );

  const pendingMatches = scans.flatMap((scan) => scan.matches);
  const selectedMatches = pendingMatches.slice(0, resultLimit);
  const thirdpartyIds = [...new Set(
    selectedMatches
      .map((match) => match.thirdparty_id)
      .filter((id): id is number => id !== undefined),
  )];
  const thirdparties = await Promise.all(thirdpartyIds.map((id) => runLimited(async () => {
    try {
      return await dependencies.getThirdparty(id);
    } catch (err) {
      if (isUnavailable(err)) return undefined;
      throw err;
    }
  })));
  const thirdpartyNames = new Map(
    thirdparties
      .filter((thirdparty): thirdparty is DolibarrThirdparty => thirdparty !== undefined)
      .map((thirdparty) => [dolibarrId(thirdparty.id), thirdparty.name]),
  );

  const matches = selectedMatches.map((match) => {
    const { thirdparty_id, ...result } = match;
    return {
      ...result,
      thirdparty_name: thirdparty_id === undefined ? undefined : thirdpartyNames.get(thirdparty_id),
    };
  });

  return {
    query: options.query.trim(),
    match_count: matches.length,
    total_matches_in_scanned_documents: pendingMatches.length,
    results_truncated: pendingMatches.length > resultLimit,
    matches,
    scan: Object.fromEntries(
      documentTypes.map((type, index) => [type, scans[index].summary]),
    ),
  };
}

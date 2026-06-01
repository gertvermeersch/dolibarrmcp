import { resolveLine, type ResolveLineError } from "../../resolvers/product.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import type { DolibarrInvoiceLine } from "../../types/dolibarr.js";
import type { LineItemInput, LineResolution, McpError } from "../../types/tools.js";

export interface DocumentCreationInput {
  thirdparty: string;
  date: string;
  refSupplier?: string;
  lines: LineItemInput[];
  validate: boolean;
}

export interface DocumentCreationSuccess {
  success: true;
  id: number;
  thirdparty: string;
  validated: boolean;
  lines: LineResolution[];
}

export interface DocumentCreationValidationError extends McpError {
  error: "VALIDATION_ERROR";
  line_errors: ResolveLineError[];
}

export type DocumentCreationResult =
  | DocumentCreationSuccess
  | DocumentCreationValidationError
  | McpError;

interface DocumentApi {
  create(data: {
    socid: number;
    date: number;
    ref_supplier?: string;
    lines?: Partial<DolibarrInvoiceLine>[];
  }): Promise<number>;
  addLine(id: number, line: Partial<DolibarrInvoiceLine>): Promise<number>;
  validate(id: number): Promise<void>;
}

export class DocumentCreationService {
  constructor(private readonly api: DocumentApi) {}

  async create(input: DocumentCreationInput): Promise<DocumentCreationResult> {
    const resolvedThirdparty = await resolveThirdparty(input.thirdparty);
    if (!resolvedThirdparty.ok) return resolvedThirdparty.error;

    // Resolve catalog refs and validate free-text lines before creating the document.
    const lineResults = await Promise.all(
      input.lines.map((line, index) => resolveLine(line, index + 1)),
    );

    const lineErrors = lineResults
      .filter((result) => !result.ok)
      .map((result) => (!result.ok ? result.error : null))
      .filter((error) => error !== null);

    if (lineErrors.length > 0) {
      return {
        error: "VALIDATION_ERROR",
        message: "One or more lines could not be resolved.",
        line_errors: lineErrors,
      };
    }

    const resolvedLines = lineResults.map((result) => {
      if (!result.ok) throw new Error("Unexpected unresolved line after validation.");
      return result.resolved;
    });

    const date = Math.floor(new Date(input.date).getTime() / 1000);
    const id = await this.api.create({
      socid: resolvedThirdparty.id,
      date,
      ...(input.refSupplier ? { ref_supplier: input.refSupplier } : {}),
    });

    for (const resolvedLine of resolvedLines) {
       await this.api.addLine(id, resolvedLine.line);
    }

    if (input.validate) await this.api.validate(id);

    return {
      success: true,
      id,
      thirdparty: resolvedThirdparty.name,
      validated: input.validate,
      lines: resolvedLines.map((line) => line.resolution),
    };
  }
}

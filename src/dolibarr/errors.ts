import { STATUS_CODES } from "node:http";
import type { McpError } from "../types/tools.js";

export class DolibarrApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public path: string,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = "DolibarrApiError";
  }
}

export function isDolibarrNotFoundError(err: unknown): boolean {
  return err instanceof DolibarrApiError && err.status === 404;
}

function getDolibarrErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = "error" in body ? body.error : undefined;
  if (!error || typeof error !== "object") return undefined;
  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" ? message : undefined;
}

function notFoundMessageForPath(path: string): string | undefined {
  const match = /^\/(invoices|supplierinvoices|proposals|thirdparties)\/(\d+)(?:\/|$|\?)/.exec(path);
  if (!match) return undefined;

  const [, resource, id] = match;
  const entity: Record<string, string> = {
    invoices: "Invoice",
    supplierinvoices: "Supplier invoice",
    proposals: "Proposal",
    thirdparties: "Thirdparty",
  };

  return `${entity[resource]} ${id} not found.`;
}

function cleanDolibarrErrorMessage(err: DolibarrApiError): string {
  const dolibarrMessage = getDolibarrErrorMessage(err.responseBody);
  const statusText = STATUS_CODES[err.status] ?? "Error";
  return dolibarrMessage
    ? `Dolibarr API error ${err.status}: ${dolibarrMessage}`
    : `Dolibarr API error ${err.status}: ${statusText}`;
}

export type ApiErrorContext = {
  supplierInvoiceRef?: string;
};

function moduleHintForPath(path: string): { name: string; action: string } | undefined {
  if (path.startsWith("/products")) {
    return {
      name: "Products/Services",
      action: "Enable the Dolibarr Products/Services API module and grant the API user read access to products/services. Services are exposed by Dolibarr through the products API with mode=2.",
    };
  }
  if (path.startsWith("/thirdparties")) {
    return {
      name: "Third parties",
      action: "Enable the Dolibarr Third parties module and grant the API user read/write access required by this tool.",
    };
  }
  if (path.startsWith("/invoices")) {
    return {
      name: "Invoices",
      action: "Enable the Dolibarr Invoices module and grant the API user invoice permissions required by this tool.",
    };
  }
  if (path.startsWith("/supplierinvoices")) {
    return {
      name: "Supplier invoices",
      action: "Enable the Dolibarr Supplier invoices module and grant the API user supplier invoice permissions required by this tool.",
    };
  }
  if (path.startsWith("/proposals")) {
    return {
      name: "Commercial proposals",
      action: "Enable the Dolibarr Commercial proposals module and grant the API user proposal permissions required by this tool.",
    };
  }
  if (path.startsWith("/orders")) {
    return {
      name: "Customer orders",
      action: "Enable the Dolibarr Customer orders module and grant the API user order permissions required by this tool.",
    };
  }
  return undefined;
}

export function isDolibarrModuleUnavailableError(err: unknown): boolean {
  if (!(err instanceof DolibarrApiError) || err.status !== 403) return false;
  return getDolibarrErrorMessage(err.responseBody) === "Forbidden" && Boolean(moduleHintForPath(err.path));
}

function dolibarrErrorText(err: DolibarrApiError): string {
  const parts = [err.message, getDolibarrErrorMessage(err.responseBody)];
  if (typeof err.responseBody === "string") parts.push(err.responseBody);
  if (err.responseBody && typeof err.responseBody === "object") parts.push(JSON.stringify(err.responseBody));
  return parts.filter(Boolean).join(" ");
}

function isInvoiceDraftWarehouseError(err: DolibarrApiError): boolean {
  if (!/^\/invoices\/\d+\/settodraft$/.test(err.path)) return false;
  if (err.status !== 400 && err.status !== 500) return false;
  return /idwarehouse|warehouse|entrep[oô]t/i.test(dolibarrErrorText(err));
}

function isInvoiceNotErasableError(err: DolibarrApiError): boolean {
  if (!/^\/invoices\/\d+$/.test(err.path)) return false;
  if (err.status !== 403) return false;
  return /invoice not erasable/i.test(dolibarrErrorText(err));
}

// Converts a DolibarrApiError into a structured McpError for tool responses
export function toApiError(
  err: unknown,
  context: ApiErrorContext = {},
): McpError | Record<string, unknown> {
  if (err instanceof DolibarrApiError) {
    const dolibarrMessage = getDolibarrErrorMessage(err.responseBody);

    if (err.status === 404) {
      return {
        error: "NOT_FOUND",
        message: notFoundMessageForPath(err.path) ?? "The requested Dolibarr record was not found.",
      };
    }

    if (err.status === 304 && /\/validate$/.test(err.path)) {
      return {
        success: true,
        status: "validated",
        note: "Already validated.",
      };
    }

    if (isInvoiceDraftWarehouseError(err)) {
      return {
        error: "WAREHOUSE_REQUIRED",
        message: "Dolibarr requires a warehouse when reopening this customer invoice to draft because stock movements may need to be reversed.",
        action: "Pass warehouse_id on this tool call, or set DOLIBARR_DEFAULT_WAREHOUSE_ID for automated invoice reopen flows.",
      };
    }

    if (isInvoiceNotErasableError(err)) {
      return {
        error: "INVOICE_NOT_ERASABLE",
        message: "Invoice is not erasable in its current state.",
        action: "Reopen the invoice to draft first, or run delete_invoice with reopen_if_validated:true when this is allowed.",
      };
    }

    if (dolibarrMessage === "ErrorBadThirdPartyName") {
      return {
        error: "VALIDATION_ERROR",
        message: "Thirdparty name is required.",
      };
    }

    if (dolibarrMessage === "ErrorRefAlreadyExists") {
      return {
        error: "DUPLICATE_REF",
        message: context.supplierInvoiceRef
          ? `Supplier invoice ref '${context.supplierInvoiceRef}' already exists for this supplier.`
          : "Supplier invoice ref already exists for this supplier.",
      };
    }

    if (err.status === 403) {
      const hint = moduleHintForPath(err.path);

      if (hint && isDolibarrModuleUnavailableError(err)) {
        return {
          error: "DOLIBARR_MODULE_UNAVAILABLE",
          message: `Dolibarr refused access to the ${hint.name} API. The module may be inactive or the API user may be missing permissions.`,
          action: hint.action,
        };
      }
    }
  }

  const message =
    err instanceof DolibarrApiError
      ? cleanDolibarrErrorMessage(err)
      : err instanceof Error
        ? err.message
        : "Unknown error";
  return { error: "DOLIBARR_API_ERROR", message };
}

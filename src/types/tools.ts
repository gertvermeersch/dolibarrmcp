// Structured error codes returned by all tools
export type McpErrorCode =
  | "THIRDPARTY_NOT_FOUND"
  | "THIRDPARTY_AMBIGUOUS"
  | "PRODUCT_PRICE_REQUIRED"
  | "INVOICE_NOT_FOUND"
  | "PROPOSAL_NOT_FOUND"
  | "CONTRACT_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_AMBIGUOUS"
  | "TASK_NOT_FOUND"
  | "TASK_AMBIGUOUS"
  | "TASK_HAS_SUBTASKS"
  | "TASK_HAS_TIME"
  | "TIME_ENTRY_NOT_FOUND"
  | "TIME_ENTRY_INVOICED"
  | "SUPPLIER_INVOICE_NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "SERVICE_NOT_FOUND"
  | "CATALOG_TYPE_MISMATCH"
  | "PAYMENT_NOT_LINKED"
  | "PAYMENT_MODE_NOT_FOUND"
  | "PAYMENT_MODE_AMBIGUOUS"
  | "PAYMENT_MODE_NOT_APPLICABLE"
  | "BANK_ACCOUNT_NOT_FOUND"
  | "BANK_ACCOUNT_AMBIGUOUS"
  | "NOT_FOUND"
  | "DELETES_DISABLED"
  | "MUST_REOPEN"
  | "NOT_DRAFT"
  | "INVOICE_NOT_ERASABLE"
  | "HAS_LINKED_DOCUMENTS"
  | "UNSUPPORTED_STATUS"
  | "WAREHOUSE_REQUIRED"
  | "DUPLICATE_REF"
  | "RENEWAL_ALREADY_INVOICED"
  | "DOLIBARR_MODULE_UNAVAILABLE"
  | "DOLIBARR_API_ERROR"
  | "VALIDATION_ERROR";

export interface McpError {
  error: McpErrorCode;
  message: string;
  action?: string;
  candidates?: ThirdpartyCandidate[] | RecordCandidate[];
}

// A project or task candidate returned with an *_AMBIGUOUS error.
export interface RecordCandidate {
  id: number;
  ref: string;
  label?: string;
  client_name?: string;
}

export interface ThirdpartyCandidate {
  id: number;
  name: string;
  type: "client" | "supplier" | "both";
}

export interface LineResolution {
  index: number;
  resolved: boolean;
  product_ref?: string;
  label: string;
  note?: string;
}

// Input type for a line item passed to create tools
export interface LineItemInput {
  product_ref?: string;
  description?: string;
  product_type?: "product" | "service";
  qty: number;
  unit_price?: number; // required for free-text lines, optional override for catalog lines
  vat_rate?: number;   // required for free-text lines, optional override for catalog lines
}

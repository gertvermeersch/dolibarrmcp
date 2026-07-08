// Structured error codes returned by all tools
export type McpErrorCode =
  | "THIRDPARTY_NOT_FOUND"
  | "THIRDPARTY_AMBIGUOUS"
  | "PRODUCT_PRICE_REQUIRED"
  | "INVOICE_NOT_FOUND"
  | "PROPOSAL_NOT_FOUND"
  | "SUPPLIER_INVOICE_NOT_FOUND"
  | "NOT_FOUND"
  | "DELETES_DISABLED"
  | "MUST_REOPEN"
  | "HAS_LINKED_DOCUMENTS"
  | "UNSUPPORTED_STATUS"
  | "WAREHOUSE_REQUIRED"
  | "DUPLICATE_REF"
  | "DOLIBARR_MODULE_UNAVAILABLE"
  | "DOLIBARR_API_ERROR"
  | "VALIDATION_ERROR";

export interface McpError {
  error: McpErrorCode;
  message: string;
  action?: string;
  candidates?: ThirdpartyCandidate[];
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
  qty: number;
  unit_price?: number; // required for free-text lines, optional override for catalog lines
  vat_rate?: number;   // required for free-text lines, optional override for catalog lines
}

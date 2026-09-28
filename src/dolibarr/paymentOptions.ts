import { dolibarr } from "./client.js";
import { dolibarrQueryString } from "./sqlFilters.js";
import type { DolibarrBankAccount, DolibarrPaymentMode } from "../types/dolibarr.js";

export async function listPaymentModes(): Promise<DolibarrPaymentMode[]> {
  const params = dolibarrQueryString({
    sortfield: "code",
    sortorder: "ASC",
    limit: "100",
    active: "1",
  });
  return dolibarr.get<DolibarrPaymentMode[]>(`/setup/dictionary/payment_types?${params}`);
}

export async function listBankAccounts(
  options: { includeClosed?: boolean } = {},
): Promise<DolibarrBankAccount[]> {
  const params: Record<string, string> = {
    sortfield: "t.label",
    sortorder: "ASC",
    limit: "100",
    properties: [
      "id",
      "rowid",
      "ref",
      "label",
      "bank",
      "type",
      "currency_code",
      "status",
      "clos",
      "number",
      "iban",
      "iban_prefix",
      "account_number",
    ].join(","),
  };
  if (!options.includeClosed) params.sqlfilters = "(t.clos:=:0)";

  return dolibarr.get<DolibarrBankAccount[]>(`/bankaccounts?${dolibarrQueryString(params)}`);
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { listOrders } from "../../dolibarr/orders.js";
import {
  getThirdparty,
  getThirdpartyClientFlag,
  getThirdpartyContacts,
  getThirdpartySupplierFlag,
  getThirdpartyType,
} from "../../dolibarr/thirdparties.js";
import { DolibarrApiError, toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel, orderStatusLabel } from "../../dolibarr/statusLabels.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import type { DolibarrContact, DolibarrInvoice, DolibarrOrder } from "../../types/dolibarr.js";
import {
  country,
  dolibarrId,
  isoDateFromTimestamp,
  money,
  moneyOrZero,
  numberOrUndefined,
  remainingToPay,
} from "../shared/normalization.js";
import { jsonContent } from "../shared/responses.js";

function isOpenInvoice(invoice: DolibarrInvoice): boolean {
  return Number(invoice.statut) === 1 && remainingToPay(invoice) > 0;
}

function contactName(contact: DolibarrContact): string | undefined {
  const parts = [contact.firstname, contact.lastname].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return contact.name;
}

function orderDate(order: DolibarrOrder): number | undefined {
  return numberOrUndefined(order.date_commande ?? order.date);
}

async function listClientInvoices(clientId: number): Promise<DolibarrInvoice[]> {
  return listInvoices(dolibarrQueryString({
    sqlfilters: `(t.fk_soc:=:${clientId})`,
    sortfield: "t.datef,t.rowid",
    sortorder: "DESC,DESC",
    limit: "100",
  }));
}

async function listLastClientOrder(clientId: number): Promise<DolibarrOrder | undefined> {
  try {
    const orders = await listOrders(dolibarrQueryString({
      sqlfilters: `(t.fk_soc:=:${clientId})`,
      sortfield: "t.date_commande,t.rowid",
      sortorder: "DESC,DESC",
      limit: "1",
    }), { suppressErrorStatuses: [403] });

    return orders[0];
  } catch (err) {
    if (err instanceof DolibarrApiError && err.status === 403) {
      return undefined;
    }
    throw err;
  }
}

export function registerGetClientOverview(server: McpServer): void {
  server.registerTool(
    "get_client_overview",
    {
      description: "Get a full overview of a client: thirdparty details, contacts, open invoices, unpaid balance, and last order date.",
      inputSchema: { client: z.string().describe("Client name or Dolibarr ID") },
    },
    async ({ client }) => {
      try {
        const resolvedClient = await resolveThirdparty(client);
        if (!resolvedClient.ok) {
          return jsonContent(resolvedClient.error);
        }

        const [thirdparty, contacts, invoices, lastOrder] = await Promise.all([
          getThirdparty(resolvedClient.id),
          getThirdpartyContacts(resolvedClient.id),
          listClientInvoices(resolvedClient.id),
          listLastClientOrder(resolvedClient.id),
        ]);
        const openInvoices = invoices.filter(isOpenInvoice);
        const unpaidBalance = moneyOrZero(openInvoices.reduce((sum, invoice) => sum + remainingToPay(invoice), 0));

        return jsonContent({
          client: {
            id: dolibarrId(thirdparty.id),
            name: thirdparty.name,
            type: getThirdpartyType(thirdparty),
            is_client: getThirdpartyClientFlag(thirdparty) > 0,
            is_supplier: getThirdpartySupplierFlag(thirdparty) > 0,
            email: thirdparty.email,
            phone: thirdparty.phone,
            code_client: thirdparty.code_client,
            code_supplier: thirdparty.code_fournisseur,
            vat_number: thirdparty.tva_intra,
            outstanding_balance: money(thirdparty.outstanding_balance),
            address: {
              street: thirdparty.address,
              zip: thirdparty.zip,
              town: thirdparty.town,
              country: country(thirdparty),
            },
          },
          contacts: contacts.map((contact) => ({
            id: dolibarrId(contact.id),
            name: contactName(contact),
            firstname: contact.firstname,
            lastname: contact.lastname,
            email: contact.email,
            phone: contact.phone_pro ?? contact.phone_perso,
            mobile: contact.phone_mobile,
            position: contact.poste,
            address: {
              street: contact.address,
              zip: contact.zip,
              town: contact.town,
            },
          })),
          open_invoices: {
            count: openInvoices.length,
            unpaid_balance: unpaidBalance,
            invoices: openInvoices.map((invoice) => ({
              id: dolibarrId(invoice.id),
              ref: invoice.ref,
              status: invoiceStatusLabel(invoice.statut),
              date: isoDateFromTimestamp(invoice.date),
              due_date: isoDateFromTimestamp(invoice.date_lim_reglement),
              total_excluding_tax: money(invoice.total_ht),
              total_tax: money(invoice.total_tva),
              total_including_tax: money(invoice.total_ttc),
              remaining_to_pay: remainingToPay(invoice),
            })),
          },
          last_order: lastOrder
            ? {
              id: dolibarrId(lastOrder.id),
              ref: lastOrder.ref,
              status: orderStatusLabel(lastOrder.statut ?? lastOrder.status),
              date: isoDateFromTimestamp(orderDate(lastOrder)),
              total_excluding_tax: money(lastOrder.total_ht),
              total_including_tax: money(lastOrder.total_ttc),
            }
            : null,
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}

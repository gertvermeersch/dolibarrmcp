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
import { jsonContent } from "../shared/responses.js";

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isPaid(invoice: DolibarrInvoice): boolean {
  const rawInvoice = invoice as DolibarrInvoice & Record<string, unknown>;
  return Number(invoice.statut) === 2 || Number(rawInvoice.paye ?? 0) === 1;
}

function remainingToPay(invoice: DolibarrInvoice): number {
  if (isPaid(invoice)) return 0;

  const rawInvoice = invoice as DolibarrInvoice & Record<string, unknown>;
  const explicitRemaining = numberOrUndefined(rawInvoice.remaintopay ?? rawInvoice.remaining_to_pay);
  if (explicitRemaining !== undefined) return explicitRemaining;

  const amountPaid = numberOrUndefined(rawInvoice.totalpaid ?? rawInvoice.total_paye) ?? 0;
  return Math.max(0, Number(invoice.total_ttc) - amountPaid);
}

function isOpenInvoice(invoice: DolibarrInvoice): boolean {
  return Number(invoice.statut) === 1 && !isPaid(invoice);
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
    }));

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
        const unpaidBalance = openInvoices.reduce((sum, invoice) => sum + remainingToPay(invoice), 0);

        return jsonContent({
          client: {
            id: thirdparty.id,
            name: thirdparty.name,
            type: getThirdpartyType(thirdparty),
            is_client: getThirdpartyClientFlag(thirdparty) > 0,
            is_supplier: getThirdpartySupplierFlag(thirdparty) > 0,
            email: thirdparty.email,
            phone: thirdparty.phone,
            code_client: thirdparty.code_client,
            code_supplier: thirdparty.code_fournisseur,
            vat_number: thirdparty.tva_intra,
            outstanding_balance: thirdparty.outstanding_balance,
            address: {
              street: thirdparty.address,
              zip: thirdparty.zip,
              town: thirdparty.town,
              country_id: thirdparty.country_id,
            },
          },
          contacts: contacts.map((contact) => ({
            id: contact.id,
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
              id: invoice.id,
              ref: invoice.ref,
              status: invoiceStatusLabel(invoice.statut),
              date: invoice.date,
              due_date: invoice.date_lim_reglement,
              total_ht: invoice.total_ht,
              total_tva: invoice.total_tva,
              total_ttc: invoice.total_ttc,
              remaining_to_pay: remainingToPay(invoice),
            })),
          },
          last_order: lastOrder
            ? {
              id: lastOrder.id,
              ref: lastOrder.ref,
              status: orderStatusLabel(lastOrder.statut ?? lastOrder.status),
              date: orderDate(lastOrder),
              total_ht: lastOrder.total_ht,
              total_ttc: lastOrder.total_ttc,
            }
            : null,
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}

// Raw Dolibarr API response types
// Add fields as needed when implementing each tool

export interface DolibarrThirdparty {
  id: number;
  name: string;
  client: number;   // 1 = client
  supplier: number; // 1 = supplier
  fournisseur?: number; // Dolibarr API/SQL supplier flag alias
  email?: string;
  phone?: string;
  address?: string;
  zip?: string;
  town?: string;
  country_id?: number;
  tva_intra?: string; // VAT number
  code_client?: string;
  code_fournisseur?: string;
  outstanding_balance?: number;
}

export interface DolibarrContact {
  id: number;
  firstname?: string;
  lastname?: string;
  name?: string;
  email?: string;
  phone_pro?: string;
  phone_perso?: string;
  phone_mobile?: string;
  poste?: string;
  address?: string;
  zip?: string;
  town?: string;
}

export interface DolibarrInvoice {
  id: number;
  ref: string;
  socid: number;
  date: number; // Unix timestamp
  date_lim_reglement: number;
  cond_reglement_id?: number; // payment terms
  total_ht: number;
  total_ttc: number;
  total_tva: number;
  statut: number; // 0=draft, 1=validated, 2=paid, 3=abandoned
  lines?: DolibarrInvoiceLine[];
}

export interface DolibarrInvoiceLine {
  id: number;
  fk_product?: number;
  product_ref?: string;
  product_label?: string;
  product_type?: number;
  desc: string;
  qty: number;
  subprice: number; // unit price excl. tax
  remise_percent?: number; // discount percentage applied to the line
  tva_tx: number;   // VAT rate
  total_ht: number;
  total_ttc: number;
  date_start?: number; // Unix timestamp; service period start
  date_end?: number;   // Unix timestamp; service period end
}

export interface DolibarrInvoicePayment {
  amount: number | string;
  date: number | string;
  num?: string;
  ref: string;
  ref_ext?: string;
  fk_bank_line?: number;
  type: string;
  typeline?: string;
}

export interface DolibarrPaymentMode {
  id: number | string;
  code: string;
  type?: number | string;
  label: string;
  module?: string;
}

export interface DolibarrBankAccount {
  id?: number | string;
  rowid?: number | string;
  ref?: string;
  label?: string;
  bank?: string;
  type?: number | string;
  currency_code?: string;
  status?: number | string;
  clos?: number | string;
  number?: string;
  iban?: string;
  iban_prefix?: string;
  account_number?: string;
}

export interface DolibarrProposal {
  id: number;
  ref: string;
  socid: number;
  date: number;
  fin_validite: number;
  total_ht: number;
  total_ttc: number;
  statut: number; // 0=draft, 1=validated, 2=signed, 3=refused, 4=billed
  lines?: DolibarrInvoiceLine[];
}

export interface DolibarrOrder {
  id: number;
  ref: string;
  socid: number;
  date?: number;
  date_commande?: number;
  total_ht?: number;
  total_ttc?: number;
  statut?: number;
  status?: number;
  lines?: DolibarrInvoiceLine[];
}

export interface DolibarrProduct {
  id: number;
  ref: string;
  label: string;
  description?: string;
  price: number;
  price_ttc?: number;
  price_base_type?: string;
  tva_tx: number;
  type: number; // 0=product, 1=service
  status?: number; // 1 = on sale
  status_buy?: number; // 1 = on purchase
  note_public?: string;
  note_private?: string;
}

// Contract line (llx_contratdet). Status: 0 = not started, 4 = running, 5 = closed.
// `date_start`/`date_end` are the planned period; the `*_real` fields are the
// actual activation/closing dates.
export interface DolibarrContractLine {
  id: number;
  fk_contrat?: number;
  fk_product?: number;
  product_ref?: string;
  product_label?: string;
  product_type?: number;
  desc?: string;
  description?: string;
  qty: number;
  subprice: number;
  remise_percent?: number;
  tva_tx: number;
  total_ht: number;
  total_ttc?: number;
  statut?: number | string;
  status?: number | string;
  date_start?: number;
  date_end?: number;
  date_start_real?: number;
  date_end_real?: number;
}

// Linked object IDs by Dolibarr element type, for example `{ facture: { "0": 12 } }`.
// Only present on `GET /contracts/{id}`, never on the list endpoint.
export type DolibarrLinkedObjectIds = Record<string, Record<string, number | string> | Array<number | string>>;

// A contract has no end date of its own: derive it from the lines.
export interface DolibarrContract {
  id: number;
  ref: string;
  socid: number;
  ref_customer?: string;
  date_contrat?: number; // Unix timestamp
  statut?: number | string; // 0 = draft, 1 = validated, 2 = closed
  status?: number | string;
  lines?: DolibarrContractLine[];
  linkedObjectsIds?: DolibarrLinkedObjectIds;
}

export interface DolibarrInterventionLine {
  id: number;
  desc?: string;
  date?: number;
  duration?: number | string; // seconds
}

export interface DolibarrIntervention {
  id: number;
  ref: string;
  socid: number;
  fk_contrat?: number | string;
  description?: string;
  statut?: number | string; // 0 = draft, 1 = validated, 2 = billed, 3 = done
  status?: number | string;
  duration?: number | string; // total seconds
  datec?: number;
  dateo?: number;
  lines?: DolibarrInterventionLine[];
}

// A project. A lead is a project with usage_opportunity = 1 and an opportunity
// stage (opp_status, an ID in llx_c_lead_status), amount and probability.
export interface DolibarrProject {
  id: number | string;
  ref: string;
  title?: string;
  description?: string;
  socid?: number | string | null;
  status?: number | string; // 0 = draft, 1 = open (validated), 2 = closed
  statut?: number | string;
  public?: number | string;
  date_start?: number | string;
  date_end?: number | string;
  date_close?: number | string;
  budget_amount?: number | string | null;
  usage_opportunity?: number | string;
  usage_task?: number | string;
  usage_bill_time?: number | string;
  opp_status?: number | string | null;
  opp_amount?: number | string | null;
  opp_percent?: number | string | null;
  note_public?: string;
  note_private?: string;
}

// A project task. Durations are in seconds.
export interface DolibarrTask {
  id: number | string;
  ref: string;
  label?: string;
  description?: string;
  fk_project?: number | string;
  fk_task_parent?: number | string;
  date_start?: number | string;
  date_end?: number | string;
  planned_workload?: number | string | null;
  duration_effective?: number | string | null;
  progress?: number | string | null;
  status?: number | string;
  billable?: number | string;
  rang?: number | string;
}

// A row of GET /projects/alltimespent: a raw SQL row, so dates are database
// strings ("YYYY-MM-DD HH:MM:SS"), not timestamps.
export interface DolibarrTimeSpentRow {
  rowid: number | string;
  element_duration: number | string; // seconds
  element_datehour?: string;
  fk_user?: number | string;
  time_note?: string | null;
  thm?: number | string | null;
  user_login?: string;
  user_firstname?: string | null;
  user_lastname?: string | null;
  project_id: number | string;
  project_ref?: string;
  project_title?: string;
  task_id: number | string;
  task_ref?: string;
  task_label?: string;
  soc_id?: number | string | null;
  soc_name?: string | null;
}

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
  tva_tx: number;
  type: number; // 0=product, 1=service
}

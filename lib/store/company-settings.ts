/**
 * Loader for the singleton company_settings row.
 * Used by quote/invoice PDFs for letterhead and remit-to info.
 */

import { supabase } from "@/lib/supabase/client";

export type CompanySettings = {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  // Banking / remittance — printed in the invoice "Remit Payment To" block.
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankAccountType: string;
  bankRoutingNumber: string;
  bankWireRoutingNumber: string;
  bankAddress: string;
};

const EMPTY: CompanySettings = {
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  email: "",
  website: "",
  taxId: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankAccountType: "",
  bankRoutingNumber: "",
  bankWireRoutingNumber: "",
  bankAddress: "",
};

export async function loadCompanySettings(): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from("company_settings")
    .select("*")
    .eq("id", "singleton")
    .maybeSingle();
  if (error) {
    console.error("[company-settings] load failed:", error);
    return EMPTY;
  }
  if (!data) return EMPTY;
  return {
    companyName:  data.company_name  ?? "",
    addressLine1: data.address_line1 ?? "",
    addressLine2: data.address_line2 ?? "",
    city:         data.city          ?? "",
    state:        data.state         ?? "",
    zip:          data.zip           ?? "",
    phone:        data.phone         ?? "",
    email:        data.email         ?? "",
    website:      data.website       ?? "",
    taxId:        data.tax_id        ?? "",
    bankName:              data.bank_name                ?? "",
    bankAccountName:       data.bank_account_name        ?? "",
    bankAccountNumber:     data.bank_account_number      ?? "",
    bankAccountType:       data.bank_account_type        ?? "",
    bankRoutingNumber:     data.bank_routing_number      ?? "",
    bankWireRoutingNumber: data.bank_wire_routing_number ?? "",
    bankAddress:           data.bank_address             ?? "",
  };
}

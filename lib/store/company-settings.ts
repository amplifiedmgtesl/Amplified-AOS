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
  };
}

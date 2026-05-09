/**
 * lib/store/customer-credits.ts
 *
 * Customer credit ledger — overpayments, manual credits, applications,
 * refunds, write-offs. Available balance = SUM(+credits) - SUM(-applications).
 *
 * Companion: docs/invoice-rewrite-plan.md
 */

import { supabase } from "@/lib/supabase/client";
import type { CustomerCreditLedgerEntry, CreditTransactionType } from "./types";

function newLedgerId(): string {
  return `ccl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToLedger(r: any): CustomerCreditLedgerEntry {
  return {
    id: r.id,
    clientId: r.client_id,
    transactionDate: r.transaction_date,
    transactionType: r.transaction_type,
    amount: Number(r.amount),
    relatedInvoiceId: r.related_invoice_id ?? undefined,
    relatedPaymentId: r.related_payment_id ?? undefined,
    refundReference: r.refund_reference ?? undefined,
    refundMemo: r.refund_memo ?? undefined,
    refundDate: r.refund_date ?? undefined,
    notes: r.notes ?? undefined,
    isActive: r.is_active ?? true,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

/** Load the full credit ledger for a client, newest first. */
export async function loadCreditLedger(clientId: string): Promise<CustomerCreditLedgerEntry[]> {
  const { data, error } = await supabase
    .from("customer_credit_ledger")
    .select("*")
    .eq("client_id", clientId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToLedger);
}

/** Compute the current available credit balance for a client. */
export async function getAvailableCredit(clientId: string): Promise<number> {
  const { data, error } = await supabase
    .from("customer_credit_ledger")
    .select("transaction_type, amount")
    .eq("client_id", clientId)
    .eq("is_active", true);
  if (error) throw error;
  let balance = 0;
  for (const r of data ?? []) {
    const sign = (r.transaction_type === "overpayment" || r.transaction_type === "manual_credit") ? 1 : -1;
    balance += sign * Number(r.amount);
  }
  return Math.round(balance * 100) / 100;
}

/** Apply a credit balance to a specific invoice. RPC validates available
 *  credit and creates the ledger entry atomically. */
export async function applyCreditToInvoice(
  clientId: string,
  invoiceId: string,
  amount: number,
  notes?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("apply_credit_to_invoice", {
    p_client_id: clientId,
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Record an overpayment as customer credit. Used when a payment exceeds
 *  the invoice balance and the user chose "hold as credit." */
export async function recordOverpayment(
  clientId: string,
  amount: number,
  paymentId: string,
  notes?: string,
): Promise<string> {
  const id = newLedgerId();
  const { error } = await supabase.from("customer_credit_ledger").insert({
    id,
    client_id: clientId,
    transaction_date: new Date().toISOString().slice(0, 10),
    transaction_type: "overpayment",
    amount,
    related_payment_id: paymentId,
    notes: notes ?? null,
  });
  if (error) throw error;
  return id;
}

/** Record a manual credit grant (admin gesture, dispute resolution, etc.). */
export async function recordManualCredit(
  clientId: string,
  amount: number,
  notes?: string,
): Promise<string> {
  const id = newLedgerId();
  const { error } = await supabase.from("customer_credit_ledger").insert({
    id,
    client_id: clientId,
    transaction_date: new Date().toISOString().slice(0, 10),
    transaction_type: "manual_credit",
    amount,
    notes: notes ?? null,
  });
  if (error) throw error;
  return id;
}

/** Record a refund — money sent back to the customer. */
export async function recordRefund(input: {
  clientId: string;
  amount: number;
  refundDate: string;
  refundReference?: string;
  refundMemo?: string;
  notes?: string;
}): Promise<string> {
  const id = newLedgerId();
  const { error } = await supabase.from("customer_credit_ledger").insert({
    id,
    client_id: input.clientId,
    transaction_date: input.refundDate,
    transaction_type: "refunded",
    amount: input.amount,
    refund_reference: input.refundReference ?? null,
    refund_memo: input.refundMemo ?? null,
    refund_date: input.refundDate,
    notes: input.notes ?? null,
  });
  if (error) throw error;
  return id;
}

/** Administratively zero out a credit balance. */
export async function recordWriteOff(
  clientId: string,
  amount: number,
  notes: string,
): Promise<string> {
  const id = newLedgerId();
  const { error } = await supabase.from("customer_credit_ledger").insert({
    id,
    client_id: clientId,
    transaction_date: new Date().toISOString().slice(0, 10),
    transaction_type: "written_off",
    amount,
    notes,
  });
  if (error) throw error;
  return id;
}

export function transactionLabel(t: CreditTransactionType): string {
  switch (t) {
    case "overpayment":        return "Overpayment received";
    case "manual_credit":      return "Manual credit granted";
    case "applied_to_invoice": return "Applied to invoice";
    case "refunded":           return "Refunded to customer";
    case "written_off":        return "Written off";
  }
}

export function transactionSign(t: CreditTransactionType): 1 | -1 {
  return (t === "overpayment" || t === "manual_credit") ? 1 : -1;
}

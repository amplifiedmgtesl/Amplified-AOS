/**
 * lib/store/customer-payments.ts
 *
 * Customer payment recording + allocation. Payments are per-client (one
 * real-world receipt) with allocation rows distributing across invoices.
 *
 * Companion: docs/invoice-rewrite-plan.md
 */

import { supabase } from "@/lib/supabase/client";
import type { CustomerPayment, PaymentAllocation, PaymentMethod } from "./types";

function newPaymentId(): string {
  return `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToPayment(r: any): CustomerPayment {
  return {
    id: r.id,
    clientId: r.client_id,
    paymentDate: r.payment_date,
    paymentMethod: r.payment_method,
    paymentAmount: Number(r.payment_amount),
    referenceNumber: r.reference_number ?? undefined,
    memo: r.memo ?? undefined,
    receivedDate: r.received_date ?? undefined,
    receivedBy: r.received_by ?? undefined,
    depositedDate: r.deposited_date ?? undefined,
    depositedBy: r.deposited_by ?? undefined,
    notes: r.notes ?? undefined,
    isActive: r.is_active ?? true,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

function rowToAllocation(r: any): PaymentAllocation {
  return {
    id: r.id,
    paymentId: r.payment_id,
    invoiceId: r.invoice_id,
    amount: Number(r.amount),
    allocatedDate: r.allocated_date,
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

export type RecordPaymentInput = {
  clientId: string;
  paymentDate: string;             // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  paymentAmount: number;
  referenceNumber?: string;
  memo?: string;
  receivedDate?: string;
  receivedBy?: string;
  depositedDate?: string;
  depositedBy?: string;
  notes?: string;
  /** How to split this payment across invoices. */
  allocations: Array<{ invoiceId: string; amount: number; notes?: string }>;
};

/** Record a customer payment + its allocations atomically (RPC). Returns the
 *  payment id. The over-allocation trigger enforces SUM(allocations.amount)
 *  ≤ paymentAmount; any extra must go through the credit ledger. */
export async function recordPayment(input: RecordPaymentInput): Promise<string> {
  const id = newPaymentId();
  const { error } = await supabase.rpc("record_customer_payment", {
    p_id: id,
    p_client_id: input.clientId,
    p_payment_date: input.paymentDate,
    p_payment_method: input.paymentMethod,
    p_payment_amount: input.paymentAmount,
    p_reference_number: input.referenceNumber ?? null,
    p_memo: input.memo ?? null,
    p_received_date: input.receivedDate ?? null,
    p_received_by: input.receivedBy ?? null,
    p_deposited_date: input.depositedDate ?? null,
    p_deposited_by: input.depositedBy ?? null,
    p_notes: input.notes ?? null,
    p_allocations: input.allocations.map((a) => ({
      invoice_id: a.invoiceId,
      amount: a.amount,
      notes: a.notes ?? null,
    })),
  });
  if (error) throw error;
  return id;
}

/** Load all payments for a client (active + inactive — caller filters). */
export async function loadPaymentsForClient(clientId: string): Promise<CustomerPayment[]> {
  const { data, error } = await supabase
    .from("customer_payments")
    .select("*")
    .eq("client_id", clientId)
    .order("payment_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToPayment);
}

/** Load payments that have at least one allocation against this invoice. */
export async function loadPaymentsForInvoice(invoiceId: string): Promise<{ payment: CustomerPayment; allocation: PaymentAllocation }[]> {
  const { data, error } = await supabase
    .from("payment_allocations")
    .select("*, customer_payments(*)")
    .eq("invoice_id", invoiceId)
    .order("allocated_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    payment: rowToPayment(r.customer_payments),
    allocation: rowToAllocation(r),
  }));
}

/** Soft-delete a payment (is_active=false). Triggers refresh of every
 *  invoice this payment touched. */
export async function deactivatePayment(paymentId: string): Promise<void> {
  const { error } = await supabase
    .from("customer_payments")
    .update({ is_active: false })
    .eq("id", paymentId);
  if (error) throw error;
}

/** Edit non-allocation fields on an existing payment. */
export async function updatePaymentMeta(
  paymentId: string,
  patch: Partial<Pick<CustomerPayment,
    "paymentDate" | "paymentMethod" | "referenceNumber" | "memo" |
    "receivedDate" | "receivedBy" | "depositedDate" | "depositedBy" | "notes"
  >>,
): Promise<void> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.paymentDate     !== undefined) dbPatch.payment_date     = patch.paymentDate;
  if (patch.paymentMethod   !== undefined) dbPatch.payment_method   = patch.paymentMethod;
  if (patch.referenceNumber !== undefined) dbPatch.reference_number = patch.referenceNumber || null;
  if (patch.memo            !== undefined) dbPatch.memo             = patch.memo || null;
  if (patch.receivedDate    !== undefined) dbPatch.received_date    = patch.receivedDate || null;
  if (patch.receivedBy      !== undefined) dbPatch.received_by      = patch.receivedBy || null;
  if (patch.depositedDate   !== undefined) dbPatch.deposited_date   = patch.depositedDate || null;
  if (patch.depositedBy     !== undefined) dbPatch.deposited_by     = patch.depositedBy || null;
  if (patch.notes           !== undefined) dbPatch.notes            = patch.notes || null;
  const { error } = await supabase
    .from("customer_payments")
    .update(dbPatch)
    .eq("id", paymentId);
  if (error) throw error;
}

/**
 * lib/store/invoice-payments.ts
 *
 * Per-invoice payment tracking. One row in `invoice_payments` = one
 * real-world payment applied to one invoice. The DB trigger
 * refresh_invoice_paid_amount maintains invoices.paid_amount as
 * SUM(active payments), and auto_paid_status_on_invoice flips status
 * to/from 'paid' as that aggregate crosses the billable threshold.
 *
 * Replaces the prior customer_payments + payment_allocations two-table
 * design (2026-05-27 redesign — single-invoice flow doesn't need the
 * extra join). If we ever ship single-payment-across-multiple-invoices,
 * a `payment_receipts` parent table can layer on top with a nullable
 * receipt_id FK — no breaking change.
 */

import { supabase } from "@/lib/supabase/client";
import type { InvoicePayment, PaymentMethod } from "./types";

function newPaymentId(): string {
  return `ipy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToPayment(r: any): InvoicePayment {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    paymentDate: r.payment_date,
    paymentMethod: r.payment_method as PaymentMethod,
    amount: Number(r.amount),
    referenceNumber: r.reference_number ?? undefined,
    memo: r.memo ?? undefined,
    notes: r.notes ?? undefined,
    isActive: r.is_active,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

export type RecordInvoicePaymentInput = {
  invoiceId: string;
  paymentDate: string;             // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  amount: number;
  referenceNumber?: string;
  memo?: string;
  notes?: string;
};

/** Record a single payment against a single invoice. Plain INSERT —
 *  trigger refresh_invoice_paid_amount updates invoices.paid_amount,
 *  trigger auto_paid_status_on_invoice flips status to 'paid' if
 *  payments now cover the balance.
 */
export async function recordInvoicePayment(input: RecordInvoicePaymentInput): Promise<string> {
  const id = newPaymentId();
  const { error } = await supabase
    .from("invoice_payments")
    .insert({
      id,
      invoice_id: input.invoiceId,
      payment_date: input.paymentDate,
      payment_method: input.paymentMethod,
      amount: input.amount,
      reference_number: input.referenceNumber ?? null,
      memo: input.memo ?? null,
      notes: input.notes ?? null,
    });
  if (error) throw error;
  return id;
}

/** Load active payments for an invoice, ordered by date desc. */
export async function loadInvoicePayments(invoiceId: string): Promise<InvoicePayment[]> {
  const { data, error } = await supabase
    .from("invoice_payments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .eq("is_active", true)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToPayment);
}

/** Soft-delete a payment. The refresh trigger recomputes paid_amount
 *  on the invoice; the auto-paid-status trigger downgrades status from
 *  'paid' back to 'sent' (or 'issued') if the balance is no longer
 *  covered. */
export async function deactivateInvoicePayment(paymentId: string): Promise<void> {
  const { error } = await supabase
    .from("invoice_payments")
    .update({ is_active: false })
    .eq("id", paymentId);
  if (error) throw error;
}

/** Edit metadata on an existing payment (amount changes also recompute
 *  paid_amount via the refresh trigger). */
export async function updateInvoicePayment(
  paymentId: string,
  patch: Partial<Pick<InvoicePayment,
    "paymentDate" | "paymentMethod" | "amount" |
    "referenceNumber" | "memo" | "notes"
  >>,
): Promise<void> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.paymentDate     !== undefined) dbPatch.payment_date     = patch.paymentDate;
  if (patch.paymentMethod   !== undefined) dbPatch.payment_method   = patch.paymentMethod;
  if (patch.amount          !== undefined) dbPatch.amount           = patch.amount;
  if (patch.referenceNumber !== undefined) dbPatch.reference_number = patch.referenceNumber || null;
  if (patch.memo            !== undefined) dbPatch.memo             = patch.memo || null;
  if (patch.notes           !== undefined) dbPatch.notes            = patch.notes || null;
  const { error } = await supabase
    .from("invoice_payments")
    .update(dbPatch)
    .eq("id", paymentId);
  if (error) throw error;
}

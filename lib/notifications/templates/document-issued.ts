/**
 * Templates: quote_issued, invoice_issued
 *
 * Email-only (the document PDF is attached by the caller). No SMS renderer,
 * so a request to SMS these is skipped with reason 'no_template'.
 *
 * Expected `data`:
 *   { docNumber, clientName?, total?, dueDate?, viewUrl? }
 */

import type { NotificationEvent, NotificationRecipient } from "../types";
import type { NotificationTemplate } from "./types";
import { esc, wrapHtml } from "./types";

function build(event: NotificationEvent, noun: "quote" | "invoice"): NotificationTemplate {
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  return {
    event,
    email: (data: Record<string, unknown>, to: NotificationRecipient) => {
      const docNumber = (data.docNumber as string) || "";
      const clientName = (data.clientName as string) || to.name || "";
      const greeting = clientName ? `Hi ${esc(clientName)},` : "Hello,";
      const totalLine =
        data.total != null ? `<p>Total: <strong>${esc(data.total)}</strong></p>` : "";
      const dueLine =
        noun === "invoice" && data.dueDate
          ? `<p>Due: ${esc(data.dueDate)}</p>`
          : "";
      const viewUrl = data.viewUrl as string | undefined;
      const viewLine = viewUrl
        ? `<p><a href="${esc(viewUrl)}">View ${noun} online</a></p>`
        : "";
      const docLabel = docNumber ? `${Noun} ${esc(docNumber)}` : Noun;
      return {
        subject: `${docLabel} from Amplified`,
        html: wrapHtml(
          `<p>${greeting}</p>` +
            `<p>Please find your ${noun}${docNumber ? ` (${esc(docNumber)})` : ""} attached.</p>` +
            totalLine +
            dueLine +
            viewLine +
            `<p>Thank you,<br/>Amplified</p>`,
        ),
        text:
          `${greeting.replace(/<[^>]+>/g, "")}\n\n` +
          `Please find your ${noun}${docNumber ? ` (${docNumber})` : ""} attached.\n` +
          (data.total != null ? `Total: ${data.total}\n` : "") +
          (viewUrl ? `View online: ${viewUrl}\n` : "") +
          `\nThank you,\nAmplified`,
      };
    },
    // No sms renderer — documents go by email only.
  };
}

export const quoteIssuedTemplate = build("quote_issued", "quote");
export const invoiceIssuedTemplate = build("invoice_issued", "invoice");

/**
 * lib/notifications/templates/index.ts
 *
 * The template registry. Maps every NotificationEvent to its template.
 * The `Record<NotificationEvent, …>` type means adding a new event to the
 * union without registering a template here is a COMPILE ERROR — templates
 * can't silently go missing.
 */

import type { NotificationEvent } from "../types";
import type { NotificationTemplate } from "./types";
import { crewAssignedTemplate } from "./crew-assigned";
import { internalAlertTemplate } from "./internal-alert";
import { invoiceIssuedTemplate, quoteIssuedTemplate } from "./document-issued";

const REGISTRY: Record<NotificationEvent, NotificationTemplate> = {
  crew_assigned: crewAssignedTemplate,
  quote_issued: quoteIssuedTemplate,
  invoice_issued: invoiceIssuedTemplate,
  internal_alert: internalAlertTemplate,
};

export function getTemplate(event: NotificationEvent): NotificationTemplate {
  return REGISTRY[event];
}

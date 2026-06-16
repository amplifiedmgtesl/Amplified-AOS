/**
 * Template: internal_alert
 *
 * Generic internal notification to staff/IT. Plain and utilitarian.
 *
 * Expected `data`:
 *   { title, message, link? }
 */

import type { NotificationTemplate } from "./types";
import { esc, wrapHtml } from "./types";

export const internalAlertTemplate: NotificationTemplate = {
  event: "internal_alert",

  email: (data) => {
    const title = (data.title as string) || "AOS alert";
    const message = (data.message as string) || "";
    const link = data.link as string | undefined;
    const linkLine = link ? `<p><a href="${esc(link)}">Open in AOS</a></p>` : "";
    return {
      subject: `[AOS] ${title}`,
      html: wrapHtml(
        `<p><strong>${esc(title)}</strong></p>` +
          `<p>${esc(message)}</p>` +
          linkLine,
      ),
      text: `[AOS] ${title}\n\n${message}\n` + (link ? `\n${link}\n` : ""),
    };
  },

  sms: (data) => {
    const title = (data.title as string) || "AOS alert";
    const message = (data.message as string) || "";
    return { body: `[AOS] ${title}: ${message}`.slice(0, 320) };
  },
};

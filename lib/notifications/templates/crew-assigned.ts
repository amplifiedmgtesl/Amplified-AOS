/**
 * Template: crew_assigned
 *
 * Expected `data`:
 *   { crewName, jobName, eventDate?, venue?, confirmUrl? }
 */

import type { NotificationTemplate } from "./types";
import { esc, wrapHtml } from "./types";

export const crewAssignedTemplate: NotificationTemplate = {
  event: "crew_assigned",

  email: (data, to) => {
    const crewName = (data.crewName as string) || to.name || "there";
    const jobName = (data.jobName as string) || "an upcoming job";
    const when = data.eventDate ? ` on ${esc(data.eventDate)}` : "";
    const venue = data.venue ? ` at ${esc(data.venue)}` : "";
    const confirmUrl = data.confirmUrl as string | undefined;
    const confirmLine = confirmUrl
      ? `<p><a href="${esc(confirmUrl)}">Confirm your availability</a></p>`
      : "";
    return {
      subject: `You're assigned: ${jobName}`,
      html: wrapHtml(
        `<p>Hi ${esc(crewName)},</p>` +
          `<p>You've been assigned to <strong>${esc(jobName)}</strong>${when}${venue}.</p>` +
          confirmLine +
          `<p>— Amplified</p>`,
      ),
      text:
        `Hi ${crewName},\n\n` +
        `You've been assigned to ${jobName}${when ? when.replace(/<[^>]+>/g, "") : ""}${venue ? venue.replace(/<[^>]+>/g, "") : ""}.\n` +
        (confirmUrl ? `Confirm your availability: ${confirmUrl}\n` : "") +
        `\n— Amplified`,
    };
  },

  sms: (data, to) => {
    const jobName = (data.jobName as string) || "an upcoming job";
    const when = data.eventDate ? ` ${data.eventDate}` : "";
    const confirmUrl = data.confirmUrl as string | undefined;
    return {
      body:
        `Amplified: you're assigned to ${jobName}${when}.` +
        (confirmUrl ? ` Confirm: ${confirmUrl}` : "") +
        ` Reply STOP to opt out.`,
    };
  },
};

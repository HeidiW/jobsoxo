// Email delivery states as people see them, and how to explain each one.

export const DELIVERY_STATUSES = ["sent", "delayed", "delivered", "complained", "bounced", "failed", "suppressed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Statuses that need someone to act: the client did not get the email. */
export const PROBLEM_STATUSES: readonly DeliveryStatus[] = ["bounced", "failed", "suppressed"];
/** Statuses that won't change any more, so there's nothing left to check. */
export const FINAL_STATUSES: readonly DeliveryStatus[] = ["delivered", "complained", "bounced", "failed", "suppressed"];

// Events can arrive out of order; never let an earlier stage overwrite a later one.
const RANK: Record<DeliveryStatus, number> = {
  sent: 1, delayed: 2, delivered: 3, complained: 4, bounced: 5, failed: 5, suppressed: 5,
};
export function shouldAdvance(current: string, next: DeliveryStatus): boolean {
  return RANK[next] >= (RANK[current as DeliveryStatus] ?? 0) && current !== next;
}

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  sent: "Sending",
  delayed: "Delayed",
  delivered: "Delivered",
  complained: "Marked as spam",
  bounced: "Bounced",
  failed: "Not sent",
  suppressed: "Blocked",
};

export const DELIVERY_KIND_LABELS: Record<string, string> = {
  invoice: "Invoice",
  change_order: "Change order",
  reminder: "Payment reminder",
};

/** Plain-language explanation for a bounce, from Resend's bounce details. */
export function explainBounce(bounce: { type?: string; subType?: string; message?: string } | undefined): string {
  const message = bounce?.message?.trim() ?? "";
  const lower = message.toLowerCase();
  if (bounce?.subType === "Suppressed" || lower.includes("suppression list")) {
    return "This address bounced before, so Resend didn't try again. Check the address with the client, then remove it from Resend's suppression list and send again.";
  }
  if (bounce?.subType === "NoEmail" || /5\.1\.1|user unknown|does not exist|no such user|not found|invalid recipient|address rejected/.test(lower)) {
    return "That email address doesn't exist. Check the spelling with the client, fix it on the client, and send again.";
  }
  if (bounce?.subType === "MailboxFull" || lower.includes("mailbox full") || lower.includes("quota")) {
    return "The client's mailbox is full. Ask them to clear space, or send to another address.";
  }
  if (/spf|dkim|dmarc|5\.7\.|not authori[sz]ed|unauthenticated/.test(lower)) {
    return "The client's mail server didn't trust mail from your domain. Check that every DNS record for your sending domain shows Verified in Resend.";
  }
  if (bounce?.subType === "ContentRejected" || /spam|blocked|policy|reject/.test(lower)) {
    return "The client's mail server blocked it as possible spam. Ask them to allow your sending address, then send again.";
  }
  return message
    ? `The client's mail server rejected it: "${message}"`
    : "The client's mail server rejected it. Open Resend → Emails for the server's exact reason.";
}

/** Plain-language explanation for a send Resend refused or couldn't attempt. */
export function explainFailure(reason: string | undefined): string {
  const raw = reason?.trim() ?? "";
  const lower = raw.toLowerCase();
  if (lower.includes("daily_quota") || lower.includes("daily quota")) {
    return "Your Resend daily sending limit was reached. It will work again tomorrow, or after upgrading your Resend plan.";
  }
  if (lower.includes("monthly_quota") || lower.includes("monthly quota")) {
    return "Your Resend monthly sending limit was reached. Upgrade your Resend plan to keep sending.";
  }
  if (lower.includes("domain") && (lower.includes("verif") || lower.includes("not found"))) {
    return "Your sending domain isn't verified in Resend yet, so it can't send for you. Finish the DNS records in Resend → Domains.";
  }
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("unauthorized") || lower.includes("restricted")) {
    return "JobsOxo's Resend API key was rejected. An admin needs to update RESEND_API_KEY.";
  }
  if (lower.includes("testing") || lower.includes("only send testing emails") || lower.includes("own email address")) {
    return "Resend is still in test mode and only sends to the account owner. Verify your sending domain in Resend to email clients.";
  }
  if (lower.includes("invalid") && lower.includes("to")) {
    return "Resend says the client's email address isn't valid. Check it for typos.";
  }
  if (lower.includes("rate") && lower.includes("limit")) {
    return "Too many emails were sent at once. Wait a minute and send again.";
  }
  return raw ? `Resend couldn't send it: ${raw}` : "Resend couldn't send it. Try again, and check Resend → Emails if it keeps happening.";
}

export const DELAYED_DETAIL = "Delivery is delayed by the client's mail server (for example, a full inbox). Resend keeps retrying for a while.";
export const COMPLAINED_DETAIL = "It was delivered, but the recipient marked it as spam. Check in with the client before emailing again.";
export const SUPPRESSED_DETAIL = "Not sent: this address is on Resend's suppression list after an earlier bounce or spam report. Fix the address or remove it from the list in Resend.";
export const BOUNCED_UNKNOWN_DETAIL = "The client's mail server rejected it. Open Resend → Emails for the server's exact reason.";

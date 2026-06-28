import type { OutgoingAttachment } from "@/lib/types";

/**
 * Max combined size of attachments on a single message. Base64 inflates bytes
 * ~33% and Gmail's raw send tops out around 25MB, so keep headroom. Enforced
 * on both the client (before upload) and the server (before send).
 */
export const ATTACHMENT_TOTAL_CAP = 20 * 1024 * 1024; // 20 MB

export function totalAttachmentBytes(atts?: Pick<OutgoingAttachment, "size">[]): number {
  return (atts ?? []).reduce((n, a) => n + (a.size || 0), 0);
}

/** True when attachments fit under the cap. */
export function attachmentsWithinCap(atts?: Pick<OutgoingAttachment, "size">[]): boolean {
  return totalAttachmentBytes(atts) <= ATTACHMENT_TOTAL_CAP;
}

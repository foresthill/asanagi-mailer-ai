import type { Email, MailboxState, OutgoingMessage } from "@/lib/types";

/**
 * The single seam every email backend implements. Features (inbox, reader,
 * send) depend only on this interface — never on Gmail/IMAP specifics — so we
 * can support both, and add more later, without touching UI or API code.
 */
export interface EmailProvider {
  readonly name: string;

  /** List messages in a mailbox, newest first. */
  list(state: MailboxState): Promise<Email[]>;

  /** Fetch a single message (full body). */
  get(id: string): Promise<Email | null>;

  /** Move a message to inbox / archived / trashed. */
  setState(id: string, state: MailboxState): Promise<void>;

  /** Mark read / unread. */
  setRead(id: string, read: boolean): Promise<void>;

  /** Star / unstar — server-side (Gmail STARRED label, IMAP \Flagged flag). */
  setStarred(id: string, starred: boolean): Promise<void>;

  /** Permanently delete (empty-trash semantics). */
  remove(id: string): Promise<void>;

  /** Send a message now. Returns the provider message id when available. */
  send(message: OutgoingMessage): Promise<{ messageId?: string }>;

  /**
   * All messages of a conversation, oldest first — across folders (inbox,
   * sent, archive). Optional: backends without server-side threading fall
   * back to the local cache (see /api/threads).
   */
  thread?(threadId: string): Promise<Email[]>;

  /**
   * Server-side full-history search (過去の深掘り用) — on-demand only, never
   * part of routine sync. Optional: backends without it stay cache-only.
   * Gmail accepts its native search operators (from: before: …).
   */
  search?(query: string, limit?: number): Promise<Email[]>;
}

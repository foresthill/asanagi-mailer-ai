// Core domain types shared across the app.

export type MailboxState = "inbox" | "archived" | "trashed";

export type Importance = "high" | "normal" | "low";

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface Email {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  /** Short preview snippet (first ~140 chars of body). */
  snippet: string;
  /** Full plain-text body. */
  body: string;
  date: string; // ISO 8601
  read: boolean;
  state: MailboxState;
  /** AI-assigned importance, populated lazily by the classifier. */
  importance?: Importance;
  /** Short AI rationale for the importance score (for transparency). */
  importanceReason?: string;
  /** Provider-specific message id used for threading (In-Reply-To). */
  messageId?: string;
}

export interface DraftRequest {
  email: Email;
  /** Optional free-form guidance the user gives up front. */
  guidance?: string;
}

export interface Draft {
  subject: string;
  body: string;
}

export type SendStatus = "scheduled" | "sent" | "failed" | "canceled";

export interface OutgoingMessage {
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  body: string;
  /** messageId of the email being replied to, for threading. */
  inReplyTo?: string;
}

export interface ScheduledSend extends OutgoingMessage {
  id: string;
  /** ISO 8601 time to send. */
  sendAt: string;
  status: SendStatus;
  createdAt: string;
  error?: string;
}

/**
 * A piece of learned knowledge about what matters to this user.
 * This is the seed of the per-user RAG / importance knowledge base.
 */
export interface ImportanceSignal {
  id: string;
  /** Matching key — a sender email, domain, or keyword. */
  pattern: string;
  kind: "sender" | "domain" | "keyword";
  importance: Importance;
  /** How many times the user has confirmed this signal. */
  weight: number;
  updatedAt: string;
}

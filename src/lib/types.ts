// Core domain types shared across the app.

export type MailboxState = "inbox" | "archived" | "trashed" | "sent";

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
  /** Which connected account this email belongs to (gmail | imap | mock). */
  account?: string;
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
  /** Blind carbon copy — never shown to other recipients. */
  bcc?: EmailAddress[];
  subject: string;
  body: string;
  /** messageId of the email being replied to, for threading. */
  inReplyTo?: string;
  /** Account to send from (gmail | imap | mock). Default: auto-detected. */
  account?: string;
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

// ---------------------------------------------------------------------------
// AI provider configuration (BYOK)
// ---------------------------------------------------------------------------

export type AIProvider = "anthropic" | "openai" | "openrouter" | "gateway";

/**
 * User-supplied AI connection settings (Bring Your Own Key). Persisted
 * locally; keys never leave the device. `provider: "auto"` lets the app
 * pick a provider from whichever keys are present.
 */
export interface AISettings {
  provider?: AIProvider | "auto";
  /** Provider-specific model id. Empty → sensible per-provider default. */
  model?: string;
  /** API keys keyed by provider. Stored locally only. */
  keys?: Partial<Record<AIProvider, string>>;
}

// ---------------------------------------------------------------------------
// Email account configuration (in-app connect)
// ---------------------------------------------------------------------------

/**
 * User-supplied email connection settings. Like AISettings these are
 * persisted locally only — OAuth tokens and passwords never leave the device.
 * All field values are strings (numbers/bools encoded) so the store can
 * uniformly treat blank as "clear this field".
 */
export interface EmailSettings {
  /** Which backend drives the mailbox; "auto" detects from credentials. */
  active?: "auto" | "gmail" | "imap" | "mock";
  gmail?: {
    /** Your own Google Cloud OAuth client (BYO client). */
    clientId?: string;
    clientSecret?: string;
    /** Issued once via the consent flow; presence = connected. */
    refreshToken?: string;
    /** Connected account address, for display. */
    address?: string;
  };
  imap?: {
    host?: string;
    port?: string; // default "993"
    secure?: string; // "false" to disable TLS
    user?: string;
    password?: string;
    archiveFolder?: string; // default "Archive"
    trashFolder?: string; // default "Trash"
    sentFolder?: string; // default "Sent"
    // SMTP (send); blank fields fall back to the IMAP values.
    smtpHost?: string;
    smtpPort?: string; // default "465"
    smtpSecure?: string;
    smtpUser?: string;
    smtpPassword?: string;
    smtpFrom?: string;
  };
}

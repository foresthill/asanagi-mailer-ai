// Core domain types shared across the app.

export type MailboxState = "inbox" | "archived" | "trashed" | "sent";

/** What the folder pane can show: a real mailbox or the starred view
 *  (スター付き is a flag spanning folders, not a folder itself). */
export type FolderView = MailboxState | "starred";

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
  /** BCC — present only on our own sent copies (送信証跡). Never visible
   *  to recipients (mail protocol strips it on delivery). */
  bcc?: EmailAddress[];
  subject: string;
  /** Short preview snippet (first ~140 chars of body). */
  snippet: string;
  /** Full plain-text body. */
  body: string;
  /** Original HTML body when present (not cached — live fetches only). */
  html?: string;
  date: string; // ISO 8601
  read: boolean;
  /** Starred / favorite — synced to the server (Gmail STARRED, IMAP \Flagged). */
  starred?: boolean;
  state: MailboxState;
  /** AI-assigned importance, populated lazily by the classifier. */
  importance?: Importance;
  /** Short AI rationale for the importance score (for transparency). */
  importanceReason?: string;
  /** Provider-specific message id used for threading (In-Reply-To). */
  messageId?: string;
  /** Which connected account this email belongs to (gmail | imap | mock). */
  account?: string;
  /** True when we have sent a message in this conversation (返信済み). */
  replied?: boolean;
}

export interface DraftRequest {
  email: Email;
  /** Optional free-form guidance the user gives up front. */
  guidance?: string;
  /** Conversation so far (oldest first) — context for the draft. */
  history?: Email[];
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
  /**
   * Conversation to attach the reply to. Gmail requires this threadId on
   * the send request (headers alone don't thread); for IMAP it is the root
   * Message-ID and goes into the References chain.
   */
  threadId?: string;
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
  /**
   * 受信箱の表示開始日（YYYY-MM-DD・任意）。これより古いメールは受信箱に
   * 出さない＝大量の過去メールを遡らずに「受信箱ゼロ」に到達できる。
   * サーバ上のメールには一切手を付けない（表示と取得クエリだけの地平線）。
   */
  inboxCutoff?: string;
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

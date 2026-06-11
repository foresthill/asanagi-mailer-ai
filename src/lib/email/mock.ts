import type { Email, MailboxState, OutgoingMessage } from "@/lib/types";
import type { EmailProvider } from "./provider";
import { store } from "@/lib/store";

const MAILBOX = "mailbox.json";

/**
 * In-repo mock provider so the app is fully runnable with zero credentials.
 * Seeds a realistic inbox on first read and persists state changes
 * (archive/trash/read) and sent items to .data/mailbox.json.
 */
function seed(): Email[] {
  const now = Date.now();
  const min = 60_000;
  const hr = 60 * min;
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  const mk = (e: Partial<Email> & { id: string }): Email => ({
    threadId: e.id,
    from: { email: "unknown@example.com" },
    to: [{ name: "You", email: "you@example.com" }],
    subject: "",
    snippet: "",
    body: "",
    date: iso(hr),
    read: false,
    state: "inbox",
    messageId: `<${e.id}@mock.local>`,
    ...e,
  });

  return [
    mk({
      id: "m1",
      from: { name: "佐藤 みなみ", email: "minami.sato@acme.co.jp" },
      subject: "【要返信】来週の打ち合わせ日程について",
      date: iso(25 * min),
      snippet: "お世話になっております。来週のキックオフMTGですが、火曜か水曜の午後で…",
      body: `お世話になっております。Acme の佐藤です。

来週のキックオフMTGの日程ですが、火曜(6/9)か水曜(6/10)の午後で調整できればと考えております。
御社のご都合のよい時間帯を2〜3つ教えていただけますでしょうか。

場所はオンライン(Google Meet)を想定しています。
よろしくお願いいたします。

佐藤 みなみ
株式会社Acme 事業開発部`,
    }),
    mk({
      id: "m2",
      from: { name: "GitHub", email: "notifications@github.com" },
      subject: "[asanagi] PR #12 が承認待ちです",
      date: iso(2 * hr),
      snippet: "Your review has been requested on pull request #12 …",
      body: `Hi there,

A review was requested from you on pull request #12 "Add scheduled send".
Please review the changes at your earliest convenience.

— The GitHub Team`,
    }),
    mk({
      id: "m3",
      from: { name: "請求担当", email: "billing@cloud-vendor.com" },
      subject: "5月分のご請求金額のお知らせ",
      date: iso(5 * hr),
      snippet: "5月分のご利用料金が確定しました。請求書をご確認ください…",
      body: `平素より格別のご高配を賜り、誠にありがとうございます。

5月分のご利用料金が確定いたしましたのでお知らせいたします。
ご請求金額: ¥48,200 (税込)
お支払期限: 2026年6月30日

詳細は管理コンソールよりご確認ください。`,
    }),
    mk({
      id: "m4",
      from: { name: "Lina from Figma", email: "lina@figma.com" },
      subject: "Re: デザインレビューありがとうございました",
      date: iso(26 * hr),
      read: true,
      snippet: "先日はお時間いただきありがとうございました。いただいたフィードバックを…",
      body: `先日はデザインレビューのお時間をいただき、ありがとうございました。
いただいたフィードバックを反映した v2 を今週末までに共有します。

引き続きよろしくお願いします。
Lina`,
    }),
    mk({
      id: "m5",
      from: { name: "週刊TechLetter", email: "news@techletter.io" },
      subject: "今週の注目ニュース10選 📨",
      date: iso(2 * 24 * hr),
      read: true,
      snippet: "今週のテック業界の動きをまとめました。AIエージェント、新型…",
      body: `今週の注目ニュースをお届けします。

1. 各社がAIエージェント基盤を相次いで発表
2. 新しいランタイムが登場
...（以下省略）

配信停止はこちら。`,
    }),
  ];
}

async function load(): Promise<Email[]> {
  const existing = await store.readJson<Email[] | null>(MAILBOX, null);
  if (existing && existing.length) return existing;
  const seeded = seed();
  await store.writeJson(MAILBOX, seeded);
  return seeded;
}

async function save(emails: Email[]): Promise<void> {
  await store.writeJson(MAILBOX, emails);
}

export class MockProvider implements EmailProvider {
  readonly name = "mock";

  async list(state: MailboxState): Promise<Email[]> {
    const all = await load();
    return all
      .filter((e) => e.state === state)
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  async get(id: string): Promise<Email | null> {
    const all = await load();
    return all.find((e) => e.id === id) ?? null;
  }

  async setState(id: string, state: MailboxState): Promise<void> {
    const all = await load();
    const e = all.find((x) => x.id === id);
    if (e) {
      e.state = state;
      await save(all);
    }
  }

  async setRead(id: string, read: boolean): Promise<void> {
    const all = await load();
    const e = all.find((x) => x.id === id);
    if (e) {
      e.read = read;
      await save(all);
    }
  }

  async setStarred(id: string, starred: boolean): Promise<void> {
    const all = await load();
    const e = all.find((x) => x.id === id);
    if (e) {
      e.starred = starred;
      await save(all);
    }
  }

  async remove(id: string): Promise<void> {
    const all = await load();
    await save(all.filter((e) => e.id !== id));
  }

  async send(message: OutgoingMessage): Promise<{ messageId?: string }> {
    // Record into a "Sent" pseudo-state so the demo shows the outgoing mail.
    const all = await load();
    const id = `sent-${Date.now()}`;
    all.push({
      id,
      threadId: message.inReplyTo ?? id,
      from: { name: "You", email: "you@example.com" },
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      snippet: message.body.slice(0, 140),
      body: message.body,
      date: new Date().toISOString(),
      read: true,
      state: "sent",
      messageId: `<${id}@mock.local>`,
    });
    await save(all);
    return { messageId: `<${id}@mock.local>` };
  }
}

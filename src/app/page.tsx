import { MailApp } from "@/components/mail/MailApp";
import { LocaleProvider } from "@/lib/i18n";
import { loadAIConfig } from "@/lib/ai/model";
import { listAccounts } from "@/lib/email/accounts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cfg = await loadAIConfig();
  // Email is the essential first step; AI (BYOK) is optional. Compute it
  // server-side so the settings badge never flashes "未設定" while the client
  // loads accounts. A real provider (gmail/imap) counts; the demo mock does not.
  const accounts = await listAccounts();
  const emailConfigured = accounts.some((a) => a.key !== "mock");
  return (
    <LocaleProvider>
      <MailApp aiConfigured={cfg.configured} emailConfigured={emailConfigured} />
    </LocaleProvider>
  );
}

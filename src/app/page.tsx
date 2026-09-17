import { MailApp } from "@/components/mail/MailApp";
import { LocaleProvider } from "@/lib/i18n";
import { loadAIConfig } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cfg = await loadAIConfig();
  return (
    <LocaleProvider>
      <MailApp aiConfigured={cfg.configured} />
    </LocaleProvider>
  );
}

import { MailApp } from "@/components/mail/MailApp";
import { loadAIConfig } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cfg = await loadAIConfig();
  return <MailApp aiConfigured={cfg.configured} />;
}

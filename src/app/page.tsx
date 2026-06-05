import { MailApp } from "@/components/mail/MailApp";
import { isAIConfigured } from "@/lib/ai/model";

export default function Home() {
  return <MailApp aiConfigured={isAIConfigured()} />;
}

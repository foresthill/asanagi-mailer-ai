import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Asanagi — 朝凪",
  description:
    "AIネイティブなメールクライアント。朝、受信箱が澄んでいる。返信提案・会話で添削・スケジュール送信。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* 保存済みの好み(system/light/dark)を描画前に「具体値」へ解決して
            <html data-theme> に適用し、初回のちらつき(FOUC)を防ぐ。system は
            OSを見て light/dark に解決。data-theme を常に具体値にすることで、
            token だけでなく dark: ユーティリティも一緒に切り替わる（@custom-variant
            dark 参照）。React管理外の属性なので hydration mismatch にはならない。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var p=localStorage.getItem('asanagi:theme')||'system';var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();",
          }}
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}

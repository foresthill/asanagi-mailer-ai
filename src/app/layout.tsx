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
        {/* 保存済みテーマ(light/dark)を描画前に <html> へ適用し、初回のちらつき
            (FOUC)を防ぐ。system は属性なし＝OS追従。React管理外の属性なので
            hydration mismatch にはならない。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('asanagi:theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();",
          }}
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}

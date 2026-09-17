"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * 軽量 i18n（テーマ切替と同じ手触り）。locale は localStorage 保持、辞書はロケール
 * 別のフラット辞書。未訳キーは en → ja → キー文字列の順にフォールバックするので、
 * fr/zh が未整備でも英語で表示され（日本語話者以外に日本語を出さない）、段階的に
 * 翻訳を足していける。UI文言のソースは日本語。
 */
export type Locale = "ja" | "en" | "fr" | "zh";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "ja", label: "日本語" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "zh", label: "中文" },
];

const KEY = "asanagi:locale";

type Dict = Record<string, string>;

// 日本語＝ソース。en＝Phase1で整備。fr/zh はキー予約（未訳は en へフォールバック）。
const ja: Dict = {
  "sidebar.tagline": "朝凪",
  "sidebar.compose": "作成",
  "sidebar.compose.title": "新規メールを作成 (C)",
  "account.all": "すべて（統合）",
  "folder.inbox": "受信箱",
  "folder.starred": "スター付き",
  "folder.sent": "送信箱",
  "folder.archived": "アーカイブ",
  "folder.trashed": "ゴミ箱",
  "nav.contacts": "連絡先",
  "nav.projects": "プロジェクト",
  "nav.projects.title": "メール履歴から抽出した案件の進捗・次アクション",
  "nav.triage": "仕分けレビュー",
  "nav.triage.title": "AI判定の確認と是正（教師データ作り）",
  "nav.ailog": "AIログ",
  "nav.ailog.title": "AIに送った内容・返答・コストのログ",
  "nav.sweep": "朝の一凪",
  "nav.sweep.title":
    "朝の一凪（ひとなぎ）— 受信箱を一括判定して片付け推奨を表示（差出人・件名・冒頭のみで判定）",
  "nav.drafts": "下書き",
  "nav.drafts.title": "保存した下書きを表示",
  "nav.scheduled": "予約送信",
  "nav.scheduled.title": "メール送信予定を表示",
  "settings.title": "AI 接続設定",
  "settings.aiConnected": "AI 接続済み",
  "settings.aiNotSet": "AIキー未設定（簡易モード）",
  "view.label": "表示",
  "view.classic": "左右",
  "view.classic.title": "左右表示: 一覧(左)｜本文(右)",
  "view.geek": "上下",
  "view.geek.title": "上下表示: 件名を上にずらり・本文を下に",
  "theme.label": "テーマ",
  "theme.system": "システム（OSに合わせる）",
  "theme.light": "ライト",
  "theme.dark": "ダーク",
  "lang.label": "言語",
};

const en: Dict = {
  "sidebar.tagline": "Asanagi",
  "sidebar.compose": "Compose",
  "sidebar.compose.title": "Compose a new email (C)",
  "account.all": "All (unified)",
  "folder.inbox": "Inbox",
  "folder.starred": "Starred",
  "folder.sent": "Sent",
  "folder.archived": "Archive",
  "folder.trashed": "Trash",
  "nav.contacts": "Contacts",
  "nav.projects": "Projects",
  "nav.projects.title": "Projects extracted from mail history — progress & next actions",
  "nav.triage": "Triage review",
  "nav.triage.title": "Review & correct AI decisions (build training data)",
  "nav.ailog": "AI log",
  "nav.ailog.title": "Log of what was sent to AI, its responses & cost",
  "nav.sweep": "Morning Calm",
  "nav.sweep.title":
    "Morning Calm — batch-triage the inbox and suggest cleanup (judged by sender, subject & opening only)",
  "nav.drafts": "Drafts",
  "nav.drafts.title": "Show saved drafts",
  "nav.scheduled": "Scheduled",
  "nav.scheduled.title": "Show scheduled sends",
  "settings.title": "AI connection settings",
  "settings.aiConnected": "AI connected",
  "settings.aiNotSet": "No AI key (basic mode)",
  "view.label": "View",
  "view.classic": "Split",
  "view.classic.title": "Split view: list (left) | message (right)",
  "view.geek": "Stacked",
  "view.geek.title": "Stacked view: subjects on top, message below",
  "theme.label": "Theme",
  "theme.system": "System (match OS)",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "lang.label": "Language",
};

// fr / zh: キー予約。未訳は en へフォールバック（順次追加）。
const fr: Dict = {
  "sidebar.compose": "Rédiger",
  "account.all": "Tout (unifié)",
  "folder.inbox": "Boîte de réception",
  "folder.starred": "Suivis",
  "folder.sent": "Envoyés",
  "folder.archived": "Archives",
  "folder.trashed": "Corbeille",
  "nav.contacts": "Contacts",
  "nav.drafts": "Brouillons",
  "theme.label": "Thème",
  "theme.system": "Système",
  "theme.light": "Clair",
  "theme.dark": "Sombre",
  "lang.label": "Langue",
};

const zh: Dict = {
  "sidebar.compose": "写邮件",
  "account.all": "全部（合并）",
  "folder.inbox": "收件箱",
  "folder.starred": "已加星标",
  "folder.sent": "已发送",
  "folder.archived": "归档",
  "folder.trashed": "垃圾箱",
  "nav.contacts": "联系人",
  "nav.drafts": "草稿",
  "theme.label": "主题",
  "theme.system": "跟随系统",
  "theme.light": "浅色",
  "theme.dark": "深色",
  "lang.label": "语言",
};

const DICTS: Record<Locale, Dict> = { ja, en, fr, zh };

/** locale → en → ja → キー の順でフォールバック。 */
function translate(locale: Locale, key: string): string {
  return DICTS[locale][key] ?? en[key] ?? ja[key] ?? key;
}

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: (k: string) => string };

const LocaleCtx = createContext<Ctx>({
  locale: "ja",
  setLocale: () => {},
  t: (k) => ja[k] ?? k,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  // 初回は ja 固定で SSR と一致させ、マウント後に保存値へ寄せる。
  const [locale, setLocaleState] = useState<Locale>("ja");

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "ja" || v === "en" || v === "fr" || v === "zh") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocaleState(v);
        document.documentElement.lang = v;
      }
    } catch {
      // localStorage 不可 → ja のまま
    }
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // 保存できなくてもこのセッションでは反映する
    }
    try {
      document.documentElement.lang = l;
    } catch {
      // noop
    }
  };

  return (
    <LocaleCtx.Provider value={{ locale, setLocale, t: (k) => translate(locale, k) }}>
      {children}
    </LocaleCtx.Provider>
  );
}

export function useI18n() {
  return useContext(LocaleCtx);
}

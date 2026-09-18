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
  "preset.label": "テーマ色",
  "preset.iris": "アイリス",
  "preset.asanagi": "朝凪",
  "preset.retro": "レトロ",
  "preset.iris.title": "アイリス（標準・紫）",
  "preset.asanagi.title": "朝凪（エメラルドブルー）",
  "preset.retro.title": "レトロ（セピア・温かみ）",
  "lang.label": "言語",
  // EmailList（一覧）
  "list.searchResults": "検索結果",
  "list.refresh": "更新",
  "list.refreshing": "更新中…",
  "list.countSuffix": "件",
  "list.select": "選択",
  "list.selectAll.title": "一括選択（すべて選択）— 残すものだけ外して、まとめてアーカイブ/ゴミ箱へ",
  "list.thread.on": "スレッド表示中（1会話=1行）— クリックで個別表示",
  "list.thread.off": "個別表示中 — クリックでスレッド表示（1会話=1行）",
  "list.threadCount.title": "この会話のメール{n}通を1行に集約しています",
  "bulk.selectedSuffix": "件選択中",
  "bulk.selectAll": "全選択",
  "bulk.clear": "選択を解除",
  "bulk.archive.title": "選択した会話をすべてアーカイブ",
  "bulk.trash.title": "選択した会話をすべてゴミ箱へ",
  "action.archive": "アーカイブ",
  "action.trash": "ゴミ箱",
  "search.placeholder": "検索（件名・本文・差出人）",
  "search.clear": "検索をクリア",
  "group.label": "グループ:",
  "group.none": "なし",
  "group.account": "アカウント",
  "group.sender": "送信者",
  "group.unknown": "(不明)",
  "empty.searchFailed": "検索に失敗しました（時間をおいて再試行してください）",
  "empty.serverSearched": "サーバ全履歴にも該当するメールがありません",
  "empty.searchLocal": "該当するメールがありません（ローカルキャッシュ内を検索）",
  "empty.inboxClean": "受信箱はすべて片付きました 🎉",
  "empty.folder": "ここには何もありません",
  "server.result": "サーバ全履歴を含む結果です",
  "server.search": "サーバ全履歴を検索",
  "server.searching": "サーバ全履歴を検索中…",
  "server.search.title": "キャッシュ外の過去メールも検索します（Gmailの検索演算子も使えます）",
  "match.label": "一致",
  "match.subject": "件名",
  "match.body": "本文",
  "match.from": "差出人",
  "match.to": "宛先",
  "importance.high": "重要",
  "importance.low": "低",
  "importance.high.title": "簡易判定: 重要（学習シグナル/キーワード。開くとAIが精密判定）",
  "importance.low.title": "簡易判定: 低（ニュースレター等。開くとAIが精密判定）",
  "row.star.on": "スターを付ける (S)",
  "row.star.off": "スターを外す (S)",
  "row.check.on": "選択する（Shift+クリックで範囲選択）",
  "row.check.off": "選択を外す",
  "row.archive.title": "アーカイブ",
  "row.trash.title": "ゴミ箱へ",
  "row.threadAll": "（会話{n}通すべて）",
  "aria.starred": "スター付き",
  "aria.replied": "返信済み",
  "aria.attachment": "添付あり",
  "aria.note": "メモあり",
  // StorageMeter / Reader
  "storage.label": "ローカルキャッシュ",
  "storage.msgSuffix": "通",
  "storage.tooltip.title": "ローカルキャッシュ（テキストのみ・添付なし）",
  "storage.tooltip.empty": "(まだキャッシュなし)",
  "storage.tooltip.retention": "保持上限: 各アカウント直近{n}通",
  "reader.empty": "メールを選択してください",
  // 検索モード / AIナレッジ
  "search.mode.keyword": "キーワード",
  "search.mode.ai": "AI",
  "search.mode.keyword.title": "キーワードで一覧を絞り込む",
  "search.mode.ai.title": "ヒットしたメール群からAIが経緯をまとめる",
  "aisearch.run": "AIで経緯をまとめる",
  "aisearch.count": "{n}件から",
  "aisearch.loading": "経緯をまとめています…",
  "aisearch.error": "経緯を作成できませんでした",
  "aisearch.retry": "再試行",
  "aisearch.heading": "AIによる経緯",
  "aisearch.regenerate": "作り直す",
  "aisearch.timeline": "時系列",
  "aisearch.points": "押さえどころ",
  "aisearch.sources": "根拠メール",
  "aisearch.empty": "先にキーワードで検索すると、その結果から経緯をまとめられます。",
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
  "preset.label": "Color",
  "preset.iris": "Iris",
  "preset.asanagi": "Asanagi",
  "preset.retro": "Retro",
  "preset.iris.title": "Iris (default, purple)",
  "preset.asanagi.title": "Asanagi (emerald blue)",
  "preset.retro.title": "Retro (sepia, warm)",
  "lang.label": "Language",
  // EmailList
  "list.searchResults": "Search results",
  "list.refresh": "Refresh",
  "list.refreshing": "Refreshing…",
  "list.countSuffix": " items",
  "list.select": "Select",
  "list.selectAll.title": "Select all — uncheck what you keep, then archive/trash the rest",
  "list.thread.on": "Threaded (1 conversation = 1 row) — click for individual view",
  "list.thread.off": "Individual view — click to thread (1 conversation = 1 row)",
  "list.threadCount.title": "{n} messages in this conversation, collapsed into one row",
  "bulk.selectedSuffix": " selected",
  "bulk.selectAll": "Select all",
  "bulk.clear": "Clear selection",
  "bulk.archive.title": "Archive all selected conversations",
  "bulk.trash.title": "Move all selected conversations to Trash",
  "action.archive": "Archive",
  "action.trash": "Trash",
  "search.placeholder": "Search (subject, body, sender)",
  "search.clear": "Clear search",
  "group.label": "Group:",
  "group.none": "None",
  "group.account": "Account",
  "group.sender": "Sender",
  "group.unknown": "(unknown)",
  "empty.searchFailed": "Search failed (please try again later)",
  "empty.serverSearched": "No matching mail even in the server's full history",
  "empty.searchLocal": "No matching mail (searched local cache)",
  "empty.inboxClean": "Inbox zero — all cleared 🎉",
  "empty.folder": "Nothing here",
  "server.result": "Results include the server's full history",
  "server.search": "Search server's full history",
  "server.searching": "Searching server's full history…",
  "server.search.title":
    "Also searches older mail beyond the cache (Gmail search operators work too)",
  "match.label": "Matched",
  "match.subject": "Subject",
  "match.body": "Body",
  "match.from": "From",
  "match.to": "To",
  "importance.high": "Important",
  "importance.low": "Low",
  "importance.high.title": "Quick guess: Important (learned signals/keywords; open for precise AI judgment)",
  "importance.low.title": "Quick guess: Low (newsletters etc.; open for precise AI judgment)",
  "row.star.on": "Add star (S)",
  "row.star.off": "Remove star (S)",
  "row.check.on": "Select (Shift+click for range)",
  "row.check.off": "Deselect",
  "row.archive.title": "Archive",
  "row.trash.title": "Move to Trash",
  "row.threadAll": " (all {n} in conversation)",
  "aria.starred": "Starred",
  "aria.replied": "Replied",
  "aria.attachment": "Has attachment",
  "aria.note": "Has note",
  // StorageMeter / Reader
  "storage.label": "Local cache",
  "storage.msgSuffix": " msgs",
  "storage.tooltip.title": "Local cache (text only, no attachments)",
  "storage.tooltip.empty": "(nothing cached yet)",
  "storage.tooltip.retention": "Retention: latest {n} msgs per account",
  "reader.empty": "Select an email",
  // Search modes / AI knowledge
  "search.mode.keyword": "Keyword",
  "search.mode.ai": "AI",
  "search.mode.keyword.title": "Filter the list by keyword",
  "search.mode.ai.title": "Let AI summarize the story from the matched emails",
  "aisearch.run": "Summarize with AI",
  "aisearch.count": "from {n}",
  "aisearch.loading": "Summarizing…",
  "aisearch.error": "Couldn't build the summary",
  "aisearch.retry": "Retry",
  "aisearch.heading": "AI summary",
  "aisearch.regenerate": "Regenerate",
  "aisearch.timeline": "Timeline",
  "aisearch.points": "Key points",
  "aisearch.sources": "Source emails",
  "aisearch.empty": "Search by keyword first, then summarize the results.",
};

// fr / zh: キー予約。未訳は en へフォールバック（順次追加）。
const fr: Dict = {
  "sidebar.tagline": "Asanagi",
  "sidebar.compose": "Rédiger",
  "sidebar.compose.title": "Rédiger un nouvel e-mail (C)",
  "account.all": "Tout (unifié)",
  "folder.inbox": "Boîte de réception",
  "folder.starred": "Suivis",
  "folder.sent": "Envoyés",
  "folder.archived": "Archives",
  "folder.trashed": "Corbeille",
  "nav.contacts": "Contacts",
  "nav.projects": "Projets",
  "nav.projects.title": "Projets extraits de l'historique des e-mails — avancement et prochaines actions",
  "nav.triage": "Revue de tri",
  "nav.triage.title": "Vérifier et corriger les décisions de l'IA (données d'entraînement)",
  "nav.ailog": "Journal IA",
  "nav.ailog.title": "Journal des envois à l'IA, des réponses et des coûts",
  "nav.sweep": "Calme du matin",
  "nav.sweep.title":
    "Calme du matin — tri groupé de la boîte de réception avec suggestions de rangement (jugé sur l'expéditeur, l'objet et le début uniquement)",
  "nav.drafts": "Brouillons",
  "nav.drafts.title": "Afficher les brouillons enregistrés",
  "nav.scheduled": "Programmés",
  "nav.scheduled.title": "Afficher les envois programmés",
  "settings.title": "Paramètres de connexion IA",
  "settings.aiConnected": "IA connectée",
  "settings.aiNotSet": "Pas de clé IA (mode simple)",
  "view.label": "Affichage",
  "view.classic": "Colonnes",
  "view.classic.title": "Affichage côte à côte : liste (gauche) | message (droite)",
  "view.geek": "Empilé",
  "view.geek.title": "Affichage empilé : objets en haut, message en bas",
  "theme.label": "Thème",
  "theme.system": "Système (selon l'OS)",
  "theme.light": "Clair",
  "theme.dark": "Sombre",
  "preset.label": "Couleur",
  "preset.iris": "Iris",
  "preset.asanagi": "Asanagi",
  "preset.retro": "Rétro",
  "preset.iris.title": "Iris (par défaut, violet)",
  "preset.asanagi.title": "Asanagi (bleu émeraude)",
  "preset.retro.title": "Rétro (sépia, chaleureux)",
  "lang.label": "Langue",
  "list.searchResults": "Résultats de recherche",
  "list.refresh": "Actualiser",
  "list.refreshing": "Actualisation…",
  "list.countSuffix": " élém.",
  "list.select": "Sélectionner",
  "list.selectAll.title":
    "Tout sélectionner — décochez ce que vous gardez, puis archivez/supprimez le reste",
  "list.thread.on": "Vue conversation (1 conversation = 1 ligne) — cliquez pour la vue individuelle",
  "list.thread.off":
    "Vue individuelle — cliquez pour grouper en conversations (1 conversation = 1 ligne)",
  "list.threadCount.title": "{n} messages dans cette conversation, regroupés en une ligne",
  "bulk.selectedSuffix": " sélectionné(s)",
  "bulk.selectAll": "Tout sélectionner",
  "bulk.clear": "Effacer la sélection",
  "bulk.archive.title": "Archiver toutes les conversations sélectionnées",
  "bulk.trash.title": "Mettre à la corbeille toutes les conversations sélectionnées",
  "action.archive": "Archiver",
  "action.trash": "Corbeille",
  "search.placeholder": "Rechercher (objet, corps, expéditeur)",
  "search.clear": "Effacer la recherche",
  "group.label": "Grouper :",
  "group.none": "Aucun",
  "group.account": "Compte",
  "group.sender": "Expéditeur",
  "group.unknown": "(inconnu)",
  "empty.searchFailed": "Échec de la recherche (réessayez plus tard)",
  "empty.serverSearched": "Aucun e-mail correspondant, même dans l'historique complet du serveur",
  "empty.searchLocal": "Aucun e-mail correspondant (cache local recherché)",
  "empty.inboxClean": "Boîte de réception vide — tout est traité 🎉",
  "empty.folder": "Rien ici",
  "server.result": "Les résultats incluent l'historique complet du serveur",
  "server.search": "Rechercher dans l'historique complet du serveur",
  "server.searching": "Recherche dans l'historique complet du serveur…",
  "server.search.title":
    "Recherche aussi les e-mails plus anciens au-delà du cache (les opérateurs de recherche Gmail fonctionnent aussi)",
  "match.label": "Correspondance",
  "match.subject": "Objet",
  "match.body": "Corps",
  "match.from": "Expéditeur",
  "match.to": "Destinataire",
  "importance.high": "Important",
  "importance.low": "Faible",
  "importance.high.title":
    "Estimation rapide : Important (signaux appris/mots-clés ; ouvrez pour un jugement IA précis)",
  "importance.low.title":
    "Estimation rapide : Faible (newsletters, etc. ; ouvrez pour un jugement IA précis)",
  "row.star.on": "Suivre (S)",
  "row.star.off": "Ne plus suivre (S)",
  "row.check.on": "Sélectionner (Maj+clic pour une plage)",
  "row.check.off": "Désélectionner",
  "row.archive.title": "Archiver",
  "row.trash.title": "Mettre à la corbeille",
  "row.threadAll": " (les {n} de la conversation)",
  "aria.starred": "Suivi",
  "aria.replied": "Répondu",
  "aria.attachment": "Pièce jointe",
  "aria.note": "Note",
  "storage.label": "Cache local",
  "storage.msgSuffix": " msg",
  "storage.tooltip.title": "Cache local (texte uniquement, sans pièces jointes)",
  "storage.tooltip.empty": "(rien en cache)",
  "storage.tooltip.retention": "Conservation : {n} derniers messages par compte",
  "reader.empty": "Sélectionnez un e-mail",
  // Modes de recherche / connaissance IA
  "search.mode.keyword": "Mot-clé",
  "search.mode.ai": "IA",
  "search.mode.keyword.title": "Filtrer la liste par mot-clé",
  "search.mode.ai.title": "Laisser l'IA résumer le contexte à partir des e-mails trouvés",
  "aisearch.run": "Résumer avec l'IA",
  "aisearch.count": "sur {n}",
  "aisearch.loading": "Résumé en cours…",
  "aisearch.error": "Impossible de créer le résumé",
  "aisearch.retry": "Réessayer",
  "aisearch.heading": "Résumé IA",
  "aisearch.regenerate": "Regénérer",
  "aisearch.timeline": "Chronologie",
  "aisearch.points": "Points clés",
  "aisearch.sources": "E-mails sources",
  "aisearch.empty": "Cherchez d'abord par mot-clé, puis résumez les résultats.",
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

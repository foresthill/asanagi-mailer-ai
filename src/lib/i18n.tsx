"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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
  "list.selectAll.title":
    "一括選択（すべて選択）— 残すものだけ外して、まとめてアーカイブ/ゴミ箱へ",
  "list.thread.on": "スレッド表示中（1会話=1行）— クリックで個別表示",
  "list.thread.off": "個別表示中 — クリックでスレッド表示（1会話=1行）",
  "list.threadCount.title": "この会話のメール{n}通を1行に集約しています",
  "list.thread.expand": "この会話を展開（全体像を表示）",
  "list.thread.collapse": "この会話を折りたたむ",
  "list.thread.loading": "会話を読み込み中…",
  "list.thread.empty": "この会話の他のメールはキャッシュにありません",
  "thread.you": "自分",
  "thread.youInitial": "自",
  "bulk.selectedSuffix": "件選択中",
  "bulk.selectAll": "全選択",
  "bulk.clear": "選択を解除",
  "bulk.archive.title": "選択した会話をすべてアーカイブ",
  "bulk.trash.title": "選択した会話をすべてゴミ箱へ",
  "bulk.importance.hint":
    "選択したメールの重要度をまとめて学習（差出人ごとのAI教師データ）",
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
  "empty.searchLocal":
    "該当するメールがありません（ローカルキャッシュ内を検索）",
  "empty.inboxClean": "受信箱はすべて片付きました 🎉",
  "empty.folder": "ここには何もありません",
  "server.result": "サーバ全履歴を含む結果です",
  "server.search": "サーバ全履歴を検索",
  "server.searching": "サーバ全履歴を検索中…",
  "server.search.title":
    "キャッシュ外の過去メールも検索します（Gmailの検索演算子も使えます）",
  "match.label": "一致",
  "match.subject": "件名",
  "match.body": "本文",
  "match.from": "差出人",
  "match.to": "宛先",
  "importance.high": "重要",
  "importance.low": "低",
  "importance.high.title":
    "簡易判定: 重要（学習シグナル/キーワード。開くとAIが精密判定）",
  "importance.low.title":
    "簡易判定: 低（ニュースレター等。開くとAIが精密判定）",
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
  "aisearch.empty":
    "先にキーワードで検索すると、その結果から経緯をまとめられます。",
  // EmailReader（本文）
  "importance.normal": "通常",
  "reader.restore": "受信箱に戻す",
  "reader.copied": "コピーしました",
  "reader.copy": "本文をコピー（引用部分は除く）",
  "reader.zoomOut": "文字を小さく",
  "reader.zoomReset": "文字サイズをリセット",
  "reader.zoomIn": "文字を大きく",
  "reader.fullscreen.off": "全画面を解除 (Esc)",
  "reader.fullscreen.on": "全画面表示（画面共有向け）",
  "reader.textMode": "テキスト",
  "reader.attachmentsLoading": "添付ファイルを読み込み中…",
  "reader.outline.toggle": "アウトライン（ツリー）表示の切替",
  "reader.classifying": "重要度を判定中…",
  "reader.importanceUnknown": "重要度は未判定",
  "reader.learn": "学習:",
  // ReplyButtons（返信/転送）
  "reply.reply": "返信",
  "reply.replyAll": "全員に返信",
  "reply.forward": "転送",
  "reply.ai": "AIで返信",
  "reply.aiAll": "AIで全員に返信",
  "reply.aiForward": "AIで転送",
  "reply.reply.title": "自分で書く返信 (Shift+R)",
  "reply.more.title": "全員に返信・転送",
  "reply.replyAll.title": "全員に返信 — 差出人＋To＋CCを引継ぎ (A)",
  "reply.forward.title": "転送 (F)",
  "reply.ai.title": "AIが返信の下書きを作成 (R)",
  "reply.aiMore.title": "その他のAI返信",
  "reply.aiForward.title": "AIが要点まとめ付きの転送文を下書き",
  // ReplyComposer（作成）
  "composer.preset.polite": "もっと丁寧に",
  "composer.thinking": "考え中…",
  "draft.inThread": "この会話の下書きがあります",
  "draft.resume": "続きを書く",
  "draft.badge": "下書きあり",
  "draft.updated": "更新",
  "composer.accountChangedWarn":
    "別アカウントから送るため、このメールは元のスレッドには連なりません（新規メール扱い）。",
  "composer.cancelWriteSelf": "中止して自分で書く",
  "composer.makingSuggestion": "提案を作成中…",
  "composer.cancelShort": "中止",
  "composer.sendErrorPrefix": "送信できませんでした:",
  "composer.close": "閉じる",
  "composer.reviewCountSuffix": "件の提案を確認してください",
  "composer.reviewLegend": "緑=追加 / 取り消し線=削除。",
  "composer.rejectAll": "すべて却下",
  "composer.acceptAll": "すべて採用",
  "composer.richModeHint":
    "画像は貼り付け/ドロップで挿入・HTML送信。AI添削は全体提案（右で指示→適用）",
  "composer.apply": "適用",
  "composer.reject": "却下",
  "composer.enterToSendLabel": "Enterで送信",
  "composer.suggestionsMadeSuffix": "件の提案を作成",
  "composer.preset.shorter": "もっと短く",
  "composer.preset.casual": "カジュアルに",
  "composer.preset.english": "英語にして",
  "composer.preset.thanks": "感謝を加えて",
  "composer.chip.polite": "丁寧に",
  "composer.chip.shorter": "短く",
  "composer.chip.rephrase": "言い換え",
  "composer.ai.forwardIntro":
    "このメールを第三者へ転送するための短い前置き文だけを書いてください。要点の簡潔なまとめ（2〜3行）を含め、宛名・署名・元メールの再掲は不要です。",
  "composer.toast.genFailed":
    "AIの下書きを生成できませんでした。引用はそのまま、手書きでどうぞ。",
  "composer.toast.genCancelled": "生成を中止しました（手書きでどうぞ）",
  "composer.toast.noBody": "本文がありません",
  "composer.toast.suggestFailed": "提案の生成に失敗しました",
  "composer.toast.noKeyNoChange": "AIキー未設定のため変更なし",
  "composer.toast.noChange": "変更はありませんでした",
  "composer.toast.suggestCancelled": "提案を中止しました",
  "composer.confirm.simplify":
    "画像と書式は簡素化されます。AIの提案を適用しますか？",
  "composer.toast.quoteNoEdit":
    "引用部分は添削できません（自分が書いた文章を選択してください）",
  "composer.toast.subjectSuggested": "件名を提案しました（本文は変更なし）",
  "composer.toast.subjectAlsoSuggested": "件名も提案しました（変更できます）",
  "composer.toast.subjectFailed": "件名の生成に失敗しました",
  "composer.toast.fileReadFailed": "ファイルの読み込みに失敗しました",
  "composer.toast.draftSaveFailed": "下書きの保存に失敗しました",
  "composer.toast.subjectEmpty": "件名が空です",
  "composer.toast.attachMentionNoFile":
    "本文に「添付」とありますが、添付ファイルがありません",
  "composer.toast.sendFailed": "送信に失敗しました",
  "composer.toast.sendFailedNet":
    "送信に失敗しました（ネットワークを確認してください）",
  "composer.toast.scheduleFailed": "予約に失敗しました",
  "composer.toast.scheduleFailedNet":
    "予約に失敗しました（ネットワークを確認してください）",
  "composer.attachOverCap.pre": "添付の合計が上限(",
  "composer.attachOverCap.post": ")を超えます",
  "composer.restore": "元に戻す",
  "composer.discardClose": "破棄して閉じる",
  "composer.from": "送信元:",
  "composer.minimize": "最小化（メールを見ながら作成）",
  "composer.subjectPlaceholder": "件名（空でも送信できます）",
  "composer.subjectAiTitle": "本文からAIで件名を生成",
  "composer.subjectAi": "件名AI",
  "composer.dropToAttach": "ここにドロップして添付",
  "composer.selectionEdit": "選択範囲を修正:",
  "composer.orInstructRight": "または右で自由に指示",
  "composer.aiDrafting": "AIが返信を下書きしています…",
  "composer.cancelGen": "提案の生成を中止",
  "composer.mustResolveAll": "すべて採用/却下するまで送信できません",
  "composer.on": "オン",
  "composer.off": "オフ",
  "composer.htmlSend.title":
    "HTML形式で送信（書式・元メールのHTML引用を保持）: ",
  "composer.rich.title":
    "リッチ編集（画像の貼り付け・ドロップで挿入・HTML送信）: ",
  "composer.scheduleTitle": "予約送信",
  "composer.scheduleShort": "予約",
  "composer.sendNow": "今すぐ送信",
  "composer.saveDraft.title": "送らずに下書きとして保存（端末内のみ）",
  "composer.saveDraft": "下書き保存",
  "composer.discard": "破棄",
  "composer.aiAssistant": "AIアシスタント",
  "composer.basicMode": "簡易モード",
  "composer.aiSuggestionWhole": "AIの提案（全体）",
  "composer.applyReplace": "適用で本文を差し替え（書式・画像は簡素化）",
  "composer.railHintRich":
    "リッチ編集中は下の入力で全体に指示できます（例: もっと丁寧に）。提案を確認して「適用」で本文に反映されます。",
  "composer.railHintPlain":
    "本文を範囲選択して「ここをこうして」と指示するか、下の入力で全体に指示できます。提案は一箇所ずつ採用/却下できます。",
  "composer.scopeRange": "範囲",
  "composer.noChangeShort": "変更なし",
  "composer.suggestionsMade.post": "件の提案を作成",
  "composer.instructWholeExample": "全体への指示（例: もっと丁寧に）",
  "composer.instructSelection": "選択範囲への指示",
  "composer.instructWhole": "全体への指示",
  "composer.enterHintSend": "（Enterで送信・Shift+Enterで改行）",
  "composer.enterHintShift": "（Shift+Enterで送信）",
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
  "nav.projects.title":
    "Projects extracted from mail history — progress & next actions",
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
  "list.selectAll.title":
    "Select all — uncheck what you keep, then archive/trash the rest",
  "list.thread.on":
    "Threaded (1 conversation = 1 row) — click for individual view",
  "list.thread.off":
    "Individual view — click to thread (1 conversation = 1 row)",
  "list.threadCount.title":
    "{n} messages in this conversation, collapsed into one row",
  "list.thread.expand": "Unfold this conversation (see the whole picture)",
  "list.thread.collapse": "Collapse this conversation",
  "list.thread.loading": "Loading conversation…",
  "list.thread.empty": "No other messages of this conversation are cached",
  "thread.you": "You",
  "thread.youInitial": "Y",
  "bulk.selectedSuffix": " selected",
  "bulk.selectAll": "Select all",
  "bulk.clear": "Clear selection",
  "bulk.archive.title": "Archive all selected conversations",
  "bulk.trash.title": "Move all selected conversations to Trash",
  "bulk.importance.hint":
    "Teach importance for all selected mail (per-sender AI training)",
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
  "importance.high.title":
    "Quick guess: Important (learned signals/keywords; open for precise AI judgment)",
  "importance.low.title":
    "Quick guess: Low (newsletters etc.; open for precise AI judgment)",
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
  // EmailReader
  "importance.normal": "Normal",
  "reader.restore": "Move to Inbox",
  "reader.copied": "Copied",
  "reader.copy": "Copy body (excludes quotes)",
  "reader.zoomOut": "Smaller text",
  "reader.zoomReset": "Reset text size",
  "reader.zoomIn": "Larger text",
  "reader.fullscreen.off": "Exit full screen (Esc)",
  "reader.fullscreen.on": "Full screen (for screen sharing)",
  "reader.textMode": "Text",
  "reader.attachmentsLoading": "Loading attachments…",
  "reader.outline.toggle": "Toggle the outline (tree) sidebar",
  "reader.classifying": "Judging importance…",
  "reader.importanceUnknown": "Importance not judged yet",
  "reader.learn": "Learn:",
  // ReplyButtons
  "reply.reply": "Reply",
  "reply.replyAll": "Reply all",
  "reply.forward": "Forward",
  "reply.ai": "AI reply",
  "reply.aiAll": "AI reply all",
  "reply.aiForward": "AI forward",
  "reply.reply.title": "Write your own reply (Shift+R)",
  "reply.more.title": "Reply all / forward",
  "reply.replyAll.title": "Reply all — keeps From + To + CC (A)",
  "reply.forward.title": "Forward (F)",
  "reply.ai.title": "AI drafts a reply (R)",
  "reply.aiMore.title": "More AI replies",
  "reply.aiForward.title": "AI drafts a forward with a summary",
  // ReplyComposer（作成）
  "composer.preset.polite": "More polite",
  "composer.thinking": "Thinking…",
  "draft.inThread": "You have a draft for this conversation",
  "draft.resume": "Continue writing",
  "draft.badge": "Has a draft",
  "draft.updated": "updated",
  "composer.accountChangedWarn":
    "Sent from a different account, so this won't join the original thread (treated as a new message).",
  "composer.cancelWriteSelf": "Cancel and write it myself",
  "composer.makingSuggestion": "Making a suggestion…",
  "composer.cancelShort": "Cancel",
  "composer.sendErrorPrefix": "Couldn't send:",
  "composer.close": "Close",
  "composer.reviewCountSuffix": " suggestion(s) to review",
  "composer.reviewLegend": "Green = added / strikethrough = removed.",
  "composer.rejectAll": "Reject all",
  "composer.acceptAll": "Accept all",
  "composer.richModeHint":
    "Paste/drop images to insert; sends as HTML. AI editing is whole-draft (instruct on the right → Apply).",
  "composer.apply": "Apply",
  "composer.reject": "Reject",
  "composer.enterToSendLabel": "Enter to send",
  "composer.suggestionsMadeSuffix": " suggestions",
  "composer.preset.shorter": "Shorter",
  "composer.preset.casual": "More casual",
  "composer.preset.english": "Into English",
  "composer.preset.thanks": "Add thanks",
  "composer.chip.polite": "Politely",
  "composer.chip.shorter": "Shorter",
  "composer.chip.rephrase": "Rephrase",
  "composer.ai.forwardIntro":
    "Write only a short intro for forwarding this email to a third party. Include a brief 2–3 line summary of the key points; no salutation, signature, or re-quoting of the original.",
  "composer.toast.genFailed":
    "Couldn't generate an AI draft. The quote is kept — please write by hand.",
  "composer.toast.genCancelled": "Generation cancelled (write by hand)",
  "composer.toast.noBody": "No body text",
  "composer.toast.suggestFailed": "Couldn't generate a suggestion",
  "composer.toast.noKeyNoChange": "No AI key, so no change",
  "composer.toast.noChange": "No changes",
  "composer.toast.suggestCancelled": "Suggestion cancelled",
  "composer.confirm.simplify":
    "Images and formatting will be simplified. Apply the AI suggestion?",
  "composer.toast.quoteNoEdit":
    "Quoted text can't be edited (select text you wrote)",
  "composer.toast.subjectSuggested": "Suggested a subject (body unchanged)",
  "composer.toast.subjectAlsoSuggested": "Also suggested a subject (editable)",
  "composer.toast.subjectFailed": "Couldn't generate a subject",
  "composer.toast.fileReadFailed": "Couldn't read the file",
  "composer.toast.draftSaveFailed": "Couldn't save the draft",
  "composer.toast.subjectEmpty": "Subject is empty",
  "composer.toast.attachMentionNoFile":
    "The body mentions an attachment, but none is attached",
  "composer.toast.sendFailed": "Send failed",
  "composer.toast.sendFailedNet": "Send failed (check your network)",
  "composer.toast.scheduleFailed": "Scheduling failed",
  "composer.toast.scheduleFailedNet": "Scheduling failed (check your network)",
  "composer.attachOverCap.pre": "Attachments exceed the limit (",
  "composer.attachOverCap.post": ")",
  "composer.restore": "Restore",
  "composer.discardClose": "Discard & close",
  "composer.from": "From:",
  "composer.minimize": "Minimize (compose while reading)",
  "composer.subjectPlaceholder": "Subject (optional)",
  "composer.subjectAiTitle": "Generate subject from body (AI)",
  "composer.subjectAi": "Subject AI",
  "composer.dropToAttach": "Drop here to attach",
  "composer.selectionEdit": "Edit selection:",
  "composer.orInstructRight": "or instruct freely on the right",
  "composer.aiDrafting": "AI is drafting a reply…",
  "composer.cancelGen": "Cancel generation",
  "composer.mustResolveAll": "Accept or reject all before sending",
  "composer.on": "On",
  "composer.off": "Off",
  "composer.htmlSend.title":
    "Send as HTML (keeps formatting & the original's HTML quote): ",
  "composer.rich.title": "Rich editing (paste/drop images, HTML send): ",
  "composer.scheduleTitle": "Schedule send",
  "composer.scheduleShort": "Schedule",
  "composer.sendNow": "Send now",
  "composer.saveDraft.title":
    "Save as a draft without sending (on device only)",
  "composer.saveDraft": "Save draft",
  "composer.discard": "Discard",
  "composer.aiAssistant": "AI assistant",
  "composer.basicMode": "Basic mode",
  "composer.aiSuggestionWhole": "AI suggestion (whole)",
  "composer.applyReplace":
    "Apply to replace the body (formatting/images simplified)",
  "composer.railHintRich":
    "While rich-editing, use the box below to instruct the whole draft (e.g. more polite). Review the suggestion and press Apply to update the body.",
  "composer.railHintPlain":
    "Select text and say how to change it, or instruct the whole draft in the box below. Accept or reject each suggestion individually.",
  "composer.scopeRange": "Range",
  "composer.noChangeShort": "No change",
  "composer.suggestionsMade.post": " suggestions",
  "composer.instructWholeExample":
    "Instruction for the whole (e.g. more polite)",
  "composer.instructSelection": "Instruction for the selection",
  "composer.instructWhole": "Instruction for the whole",
  "composer.enterHintSend": " (Enter to send, Shift+Enter for newline)",
  "composer.enterHintShift": " (Shift+Enter to send)",
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
  "nav.projects.title":
    "Projets extraits de l'historique des e-mails — avancement et prochaines actions",
  "nav.triage": "Revue de tri",
  "nav.triage.title":
    "Vérifier et corriger les décisions de l'IA (données d'entraînement)",
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
  "view.classic.title":
    "Affichage côte à côte : liste (gauche) | message (droite)",
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
  "list.thread.on":
    "Vue conversation (1 conversation = 1 ligne) — cliquez pour la vue individuelle",
  "list.thread.off":
    "Vue individuelle — cliquez pour grouper en conversations (1 conversation = 1 ligne)",
  "list.threadCount.title":
    "{n} messages dans cette conversation, regroupés en une ligne",
  "list.thread.expand": "Déplier cette conversation (vue d’ensemble)",
  "list.thread.collapse": "Replier cette conversation",
  "list.thread.loading": "Chargement de la conversation…",
  "list.thread.empty": "Aucun autre message de cette conversation en cache",
  "thread.you": "Moi",
  "thread.youInitial": "M",
  "bulk.selectedSuffix": " sélectionné(s)",
  "bulk.selectAll": "Tout sélectionner",
  "bulk.clear": "Effacer la sélection",
  "bulk.archive.title": "Archiver toutes les conversations sélectionnées",
  "bulk.trash.title":
    "Mettre à la corbeille toutes les conversations sélectionnées",
  "bulk.importance.hint":
    "Apprendre l’importance des mails sélectionnés (données d’entraînement par expéditeur)",
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
  "empty.serverSearched":
    "Aucun e-mail correspondant, même dans l'historique complet du serveur",
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
  "storage.tooltip.title":
    "Cache local (texte uniquement, sans pièces jointes)",
  "storage.tooltip.empty": "(rien en cache)",
  "storage.tooltip.retention":
    "Conservation : {n} derniers messages par compte",
  "reader.empty": "Sélectionnez un e-mail",
  // Modes de recherche / connaissance IA
  "search.mode.keyword": "Mot-clé",
  "search.mode.ai": "IA",
  "search.mode.keyword.title": "Filtrer la liste par mot-clé",
  "search.mode.ai.title":
    "Laisser l'IA résumer le contexte à partir des e-mails trouvés",
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
  // EmailReader
  "importance.normal": "Normal",
  "reader.restore": "Remettre en boîte de réception",
  "reader.copied": "Copié",
  "reader.copy": "Copier le corps (hors citations)",
  "reader.zoomOut": "Réduire le texte",
  "reader.zoomReset": "Réinitialiser la taille du texte",
  "reader.zoomIn": "Agrandir le texte",
  "reader.fullscreen.off": "Quitter le plein écran (Échap)",
  "reader.fullscreen.on": "Plein écran (partage d'écran)",
  "reader.textMode": "Texte",
  "reader.attachmentsLoading": "Chargement des pièces jointes…",
  "reader.outline.toggle": "Afficher/masquer le plan (arborescence)",
  "reader.classifying": "Évaluation de l'importance…",
  "reader.importanceUnknown": "Importance non évaluée",
  "reader.learn": "Apprendre :",
  // ReplyButtons
  "reply.reply": "Répondre",
  "reply.replyAll": "Répondre à tous",
  "reply.forward": "Transférer",
  "reply.ai": "Répondre (IA)",
  "reply.aiAll": "Répondre à tous (IA)",
  "reply.aiForward": "Transférer (IA)",
  "reply.reply.title": "Écrire soi-même la réponse (Shift+R)",
  "reply.more.title": "Répondre à tous / transférer",
  "reply.replyAll.title": "Répondre à tous — conserve De + À + Cc (A)",
  "reply.forward.title": "Transférer (F)",
  "reply.ai.title": "L'IA rédige une réponse (R)",
  "reply.aiMore.title": "Autres réponses IA",
  "reply.aiForward.title": "L'IA rédige un transfert avec résumé",
  // ReplyComposer（作成）
  "composer.preset.polite": "Plus poli",
  "composer.thinking": "Réflexion…",
  "draft.inThread": "Vous avez un brouillon pour cette conversation",
  "draft.resume": "Continuer",
  "draft.badge": "Brouillon",
  "draft.updated": "modifié",
  "composer.accountChangedWarn":
    "Envoyé depuis un autre compte : ce message ne rejoindra pas le fil d'origine (traité comme un nouveau message).",
  "composer.cancelWriteSelf": "Annuler et écrire moi-même",
  "composer.makingSuggestion": "Création de la suggestion…",
  "composer.cancelShort": "Annuler",
  "composer.sendErrorPrefix": "Impossible d'envoyer :",
  "composer.close": "Fermer",
  "composer.reviewCountSuffix": " suggestion(s) à vérifier",
  "composer.reviewLegend": "Vert = ajouté / barré = supprimé.",
  "composer.rejectAll": "Tout rejeter",
  "composer.acceptAll": "Tout accepter",
  "composer.richModeHint":
    "Collez/déposez des images ; envoi en HTML. La retouche IA porte sur l'ensemble (instruire à droite → Appliquer).",
  "composer.apply": "Appliquer",
  "composer.reject": "Rejeter",
  "composer.enterToSendLabel": "Entrée pour envoyer",
  "composer.suggestionsMadeSuffix": " suggestions",
  "composer.preset.shorter": "Plus court",
  "composer.preset.casual": "Plus décontracté",
  "composer.preset.english": "En anglais",
  "composer.preset.thanks": "Ajouter des remerciements",
  "composer.chip.polite": "Poliment",
  "composer.chip.shorter": "Plus court",
  "composer.chip.rephrase": "Reformuler",
  "composer.ai.forwardIntro":
    "Rédigez uniquement une courte introduction pour transférer cet e-mail à un tiers. Incluez un résumé bref (2–3 lignes) des points clés ; sans formule d'appel, signature, ni recopie de l'original.",
  "composer.toast.genFailed":
    "Impossible de générer un brouillon IA. La citation est conservée — écrivez à la main.",
  "composer.toast.genCancelled": "Génération annulée (écrivez à la main)",
  "composer.toast.noBody": "Aucun corps de texte",
  "composer.toast.suggestFailed": "Impossible de générer une suggestion",
  "composer.toast.noKeyNoChange": "Pas de clé IA, aucun changement",
  "composer.toast.noChange": "Aucun changement",
  "composer.toast.suggestCancelled": "Suggestion annulée",
  "composer.confirm.simplify":
    "Les images et la mise en forme seront simplifiées. Appliquer la suggestion de l'IA ?",
  "composer.toast.quoteNoEdit":
    "Le texte cité ne peut pas être modifié (sélectionnez votre propre texte)",
  "composer.toast.subjectSuggested": "Objet suggéré (corps inchangé)",
  "composer.toast.subjectAlsoSuggested": "Objet également suggéré (modifiable)",
  "composer.toast.subjectFailed": "Impossible de générer un objet",
  "composer.toast.fileReadFailed": "Impossible de lire le fichier",
  "composer.toast.draftSaveFailed": "Impossible d'enregistrer le brouillon",
  "composer.toast.subjectEmpty": "L'objet est vide",
  "composer.toast.attachMentionNoFile":
    "Le corps mentionne une pièce jointe, mais aucune n'est jointe",
  "composer.toast.sendFailed": "Échec de l'envoi",
  "composer.toast.sendFailedNet": "Échec de l'envoi (vérifiez le réseau)",
  "composer.toast.scheduleFailed": "Échec de la programmation",
  "composer.toast.scheduleFailedNet":
    "Échec de la programmation (vérifiez le réseau)",
  "composer.attachOverCap.pre": "Les pièces jointes dépassent la limite (",
  "composer.attachOverCap.post": ")",
  "composer.restore": "Restaurer",
  "composer.discardClose": "Abandonner et fermer",
  "composer.from": "De :",
  "composer.minimize": "Réduire (rédiger en lisant)",
  "composer.subjectPlaceholder": "Objet (facultatif)",
  "composer.subjectAiTitle": "Générer l'objet à partir du corps (IA)",
  "composer.subjectAi": "Objet IA",
  "composer.dropToAttach": "Déposez ici pour joindre",
  "composer.selectionEdit": "Modifier la sélection :",
  "composer.orInstructRight": "ou donnez une instruction libre à droite",
  "composer.aiDrafting": "L'IA rédige une réponse…",
  "composer.cancelGen": "Annuler la génération",
  "composer.mustResolveAll": "Acceptez/rejetez tout avant d'envoyer",
  "composer.on": "Activé",
  "composer.off": "Désactivé",
  "composer.htmlSend.title":
    "Envoyer en HTML (conserve la mise en forme et la citation HTML) : ",
  "composer.rich.title":
    "Édition enrichie (coller/déposer des images, envoi HTML) : ",
  "composer.scheduleTitle": "Envoi programmé",
  "composer.scheduleShort": "Programmer",
  "composer.sendNow": "Envoyer",
  "composer.saveDraft.title":
    "Enregistrer comme brouillon sans envoyer (sur l'appareil uniquement)",
  "composer.saveDraft": "Enregistrer le brouillon",
  "composer.discard": "Abandonner",
  "composer.aiAssistant": "Assistant IA",
  "composer.basicMode": "Mode simple",
  "composer.aiSuggestionWhole": "Suggestion IA (ensemble)",
  "composer.applyReplace":
    "Appliquer pour remplacer le corps (mise en forme/images simplifiées)",
  "composer.railHintRich":
    "En édition enrichie, utilisez le champ ci-dessous pour donner une instruction globale (ex. plus poli). Vérifiez la suggestion puis « Appliquer ».",
  "composer.railHintPlain":
    "Sélectionnez du texte et dites comment le modifier, ou donnez une instruction globale ci-dessous. Acceptez/rejetez chaque suggestion.",
  "composer.scopeRange": "Sélection",
  "composer.noChangeShort": "Aucun changement",
  "composer.suggestionsMade.post": " suggestions",
  "composer.instructWholeExample": "Instruction globale (ex. plus poli)",
  "composer.instructSelection": "Instruction pour la sélection",
  "composer.instructWhole": "Instruction globale",
  "composer.enterHintSend":
    " (Entrée pour envoyer, Maj+Entrée pour un saut de ligne)",
  "composer.enterHintShift": " (Maj+Entrée pour envoyer)",
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

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (k: string) => string;
};

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
    <LocaleCtx.Provider
      value={{ locale, setLocale, t: (k) => translate(locale, k) }}
    >
      {children}
    </LocaleCtx.Provider>
  );
}

export function useI18n() {
  return useContext(LocaleCtx);
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  Check,
  AlertCircle,
  KeyRound,
  Sparkles,
} from "lucide-react";
import type { AIProvider } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import {
  getSweepAutoMode,
  setSweepAutoMode,
  type SweepAutoMode,
} from "@/lib/sweep-prefs";
import {
  getOsNotify,
  setOsNotify,
  getMailNotify,
  setMailNotify,
  getImportantOnly,
  setImportantOnly,
  ensureNotifyPermission,
  notifySupported,
} from "@/lib/notify-prefs";
import { AccountsSection } from "./AccountsSection";
import { ReplySignatureSection } from "./ReplySignatureSection";
import { WritingNoteSection } from "./WritingNoteSection";
import { WritingSamplesSection } from "./WritingSamplesSection";
import { OpenProjectSection } from "./OpenProjectSection";
import { DevlogSection } from "./DevlogSection";
import { NextcloudSection } from "./NextcloudSection";
import { ObsidianSection } from "./ObsidianSection";
import { TeamRulesSection } from "./TeamRulesSection";
import { DownloadSection } from "./DownloadSection";
import { JevPlayground } from "./JevPlayground";
import { AI_STATUS_REFRESH_EVENT } from "./AiStatusChip";

// UI 上の選択肢。"onprem"（ローカル/オンプレ Ollama 等）は保存時に
// provider="openai" + baseUrl にマップする UI 専用の別名（内部に openai プロバイダは
// 1つだが、UIでは「クラウドOpenAI」と「ローカル/オンプレ」を別項目に分けて迷わせない）。
type ProviderChoice = AIProvider | "auto" | "onprem";

/** UI選択 → 実プロバイダ。onprem は openai（+baseUrl）として扱う。 */
function realProvider(p: ProviderChoice): AIProvider | "auto" {
  return p === "onprem" ? "openai" : p;
}

interface KeyStatus {
  set: boolean;
  last4?: string;
}

/** 選択プロバイダに保存されたモデルID（per-provider → 旧・共通のフォールバック）。 */
function modelForProvider(v: View, p: ProviderChoice): string {
  const rp = realProvider(p);
  if (rp === "auto") return v.model ?? "";
  return v.models?.[rp] || v.model || "";
}
function judgmentForProvider(v: View, p: ProviderChoice): string {
  const rp = realProvider(p);
  if (rp === "auto") return v.judgmentModel ?? "";
  return v.judgmentModels?.[rp] || v.judgmentModel || "";
}

interface View {
  provider: ProviderChoice;
  model: string;
  judgmentModel: string;
  /** プロバイダごとに保存されたモデルID（切替時の復元用）。 */
  models: Record<AIProvider, string>;
  judgmentModels: Record<AIProvider, string>;
  baseUrl: string;
  fallbackProvider: "none" | AIProvider;
  piiMask: boolean;
  nerMask: boolean;
  keys: Record<AIProvider, KeyStatus>;
  jevKey: KeyStatus;
  jevEndpoint: "typesafe" | "openrouter";
  defaultModels: Record<AIProvider, string>;
  cheapModels: Record<AIProvider, string>;
  active: {
    provider: AIProvider;
    model: string;
    judgmentModel: string;
    configured: boolean;
    source: "settings" | "env";
  };
}

// Brand labels stay verbatim; only "auto" and the hints are localized (by key).
const PROVIDER_OPTIONS: {
  value: ProviderChoice;
  label?: string;
  labelKey?: string;
  hintKey: string;
  needsKey: boolean;
}[] = [
  {
    value: "openrouter",
    label: "OpenRouter",
    hintKey: "conn.provider.openrouter.hint",
    needsKey: true,
  },
  {
    value: "anthropic",
    label: "Claude (Anthropic)",
    hintKey: "conn.provider.anthropic.hint",
    needsKey: true,
  },
  {
    value: "openai",
    label: "OpenAI",
    hintKey: "conn.provider.openai.hint",
    needsKey: true,
  },
  {
    value: "onprem",
    labelKey: "conn.provider.onprem.label",
    hintKey: "conn.provider.onprem.hint",
    needsKey: false, // local Ollama needs no key (gated proxy may; optional)
  },
  {
    value: "gateway",
    label: "Vercel AI Gateway",
    hintKey: "conn.provider.gateway.hint",
    needsKey: false,
  },
  {
    value: "auto",
    labelKey: "conn.provider.auto.label",
    hintKey: "conn.provider.auto.hint",
    needsKey: false,
  },
];

const KEY_PLACEHOLDER: Record<AIProvider, string> = {
  openrouter: "sk-or-...",
  anthropic: "sk-ant-...",
  openai: "sk-...",
  gateway: "(環境変数で設定)",
};

export function ConnectionsSettings({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (configured: boolean) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("openrouter");
  const [model, setModel] = useState("");
  const [judgmentModel, setJudgmentModel] = useState("");
  // OpenAI-compatible endpoint (e.g. Ollama /v1) — on-prem inference.
  const [baseUrl, setBaseUrl] = useState("");
  // On-prem→cloud fallback target (opt-in, default "none").
  const [fallbackProvider, setFallbackProvider] = useState<"none" | AIProvider>(
    "none",
  );
  // Keys the user typed this session (per provider). Empty string = clear.
  const [keyInputs, setKeyInputs] = useState<
    Partial<Record<AIProvider, string>>
  >({});
  // Jev (TypeSafe) key typed this session; undefined = untouched, "" = clear.
  const [jevKeyInput, setJevKeyInput] = useState<string | undefined>(undefined);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  // On-prem endpoint (Ollama /v1): model discovery + connection check. The
  // picker removes hand-typed-model 404s; the status line makes a dead tunnel
  // obvious ("未接続") instead of a cryptic fetch error later.
  const [endpointModels, setEndpointModels] = useState<string[] | null>(null);
  const [endpointStatus, setEndpointStatus] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setTest(null);
    try {
      const res = await fetch("/api/settings/ai");
      const data = (await res.json()) as View;
      setView(data);
      // Default the picker to OpenRouter on a pristine ("auto") state so the
      // key field is visible immediately; "auto" stays selectable explicitly.
      const saved: ProviderChoice =
        data.provider && data.provider !== "auto"
          ? data.provider
          : "openrouter";
      // openai + baseUrl 設定済み = ローカル/オンプレ。UIでは "onprem" 項目を選ぶ。
      const initProvider: ProviderChoice =
        saved === "openai" && (data.baseUrl ?? "").trim() ? "onprem" : saved;
      setProvider(initProvider);
      // モデルは選択中プロバイダの保存値で初期化（無ければ旧・共通値）。
      setModel(modelForProvider(data, initProvider));
      setJudgmentModel(judgmentForProvider(data, initProvider));
      setBaseUrl(data.baseUrl ?? "");
      setFallbackProvider(data.fallbackProvider ?? "none");
      setKeyInputs({});
      setJevKeyInput(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch current settings when the dialog opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const selectedOpt = PROVIDER_OPTIONS.find((o) => o.value === provider);

  // 「いま使うAI」1行サマリ: プロバイダ＝本命、フォールバック＝ローカル停止時の
  // 予備、という優先関係を日本語で明示する（フォーム状態を即反映）。単独クラウド
  // はモデルまで、オンプレは host と予備先を出す。
  const brand = (p: AIProvider): string =>
    PROVIDER_OPTIONS.find((o) => o.value === p)?.label ?? p;
  const activeSummary = ((): string => {
    if (provider === "auto") return t("conn.active.auto");
    if (provider === "onprem") {
      let host = baseUrl.trim();
      try {
        if (host) host = new URL(baseUrl).host;
      } catch {
        /* keep raw baseUrl when it isn't a full URL yet */
      }
      const loc = t("conn.active.local") + (host ? `（${host}）` : "");
      return fallbackProvider === "none"
        ? `${loc} ／ ${t("conn.active.standby")}: ${t("conn.active.none")}`
        : `${loc} → ${t("conn.active.down")} ${brand(fallbackProvider)}`;
    }
    const m = model.trim() || view?.defaultModels?.[provider] || "";
    return m ? `${brand(provider)}（${m}）` : brand(provider);
  })();

  // 本命プロバイダの切替（カード選択・以前は select の onChange に直書きだった）。
  const selectProvider = (next: ProviderChoice) => {
    setProvider(next);
    // 切替先プロバイダの保存モデルを復元（モデル欄を触らなくてよい）。
    if (view) {
      setModel(modelForProvider(view, next));
      setJudgmentModel(judgmentForProvider(view, next));
    }
    // onprem を選んだのに baseUrl 空だと保存後 openai に戻ってしまう。Ollama の
    // 既定エンドポイント(11434)を補完して「選んだのに消える」を防ぐ。別ポート/
    // トンネルなら手で直す。
    if (next === "onprem" && !baseUrl.trim()) {
      setBaseUrl("http://localhost:11434/v1");
    }
    setTest(null);
  };
  // onprem は openai のキー枠を使う（ローカルは任意）。auto/gateway はキー無し。
  const keyProvider: AIProvider | null =
    provider === "onprem"
      ? "openai"
      : provider !== "auto" && provider !== "gateway"
        ? provider
        : null;

  async function persist(): Promise<View | null> {
    const keys: Partial<Record<AIProvider, string>> = {};
    for (const [k, v] of Object.entries(keyInputs)) {
      if (v !== undefined) keys[k as AIProvider] = v;
    }
    // onprem は実プロバイダ openai として保存（+baseUrl がローカル/オンプレの印）。
    const rp = realProvider(provider);
    // モデルはプロバイダ別に保存（切替で復元される）。auto は旧・共通へ。
    const modelFields =
      rp === "auto"
        ? { model, judgmentModel }
        : {
            models: { [rp]: model } as Partial<Record<AIProvider, string>>,
            judgmentModels: { [rp]: judgmentModel } as Partial<
              Record<AIProvider, string>
            >,
          };
    const res = await fetch("/api/settings/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: rp,
        ...modelFields,
        baseUrl,
        fallbackProvider,
        keys,
        // Only send the Jev key when the user touched the field (undefined = keep).
        ...(jevKeyInput !== undefined ? { jevApiKey: jevKeyInput } : {}),
      }),
    });
    const data = (await res.json()) as View & { ok: boolean };
    setView(data);
    setKeyInputs({});
    setJevKeyInput(undefined);
    onSaved(data.active.configured);
    // サイドバーのAIステータスチップを即更新（ポーリング待ちで旧プロバイダ＝
    // openrouter のままに見える問題の修正）。保存はPOST完了済みなので競合なし。
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(AI_STATUS_REFRESH_EVENT));
    }
    return data;
  }

  async function handleSave() {
    setSaving(true);
    setTest(null);
    try {
      await persist();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTest(null);
    try {
      await persist(); // save current form first so the test uses it
      const res = await fetch("/api/settings/ai/test", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        label?: string;
        sample?: string;
        error?: string;
      };
      setTest(
        data.ok
          ? {
              ok: true,
              msg: t("conn.test.ok").replace("{label}", data.label ?? ""),
            }
          : { ok: false, msg: data.error ?? t("conn.test.fail") },
      );
    } catch {
      setTest({ ok: false, msg: t("conn.test.fail") });
    } finally {
      setTesting(false);
    }
  }

  async function fetchEndpointModels() {
    setFetchingModels(true);
    setEndpointStatus(null);
    try {
      const res = await fetch("/api/settings/ai/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // keyInputs.openai is undefined unless typed this session → the server
        // falls back to the stored (masked) key, or none for a bare Ollama.
        body: JSON.stringify({ baseUrl, apiKey: keyInputs.openai }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        models?: string[];
        error?: string;
      };
      if (data.ok) {
        const models = data.models ?? [];
        setEndpointModels(models);
        setEndpointStatus({
          ok: true,
          msg:
            models.length > 0
              ? t("conn.endpoint.ok").replace("{n}", String(models.length))
              : t("conn.endpoint.empty"),
        });
        // Suggest the first model only when the field is empty — never silently
        // override a model id the user typed on purpose.
        if (models.length > 0 && !model.trim()) setModel(models[0]);
      } else {
        setEndpointModels(null);
        setEndpointStatus({
          ok: false,
          msg: `${t("conn.endpoint.fail")}${data.error ? `（${data.error}）` : ""}`,
        });
      }
    } catch {
      setEndpointModels(null);
      setEndpointStatus({ ok: false, msg: t("conn.endpoint.fail") });
    } finally {
      setFetchingModels(false);
    }
  }

  const currentKeyStatus = keyProvider ? view?.keys[keyProvider] : undefined;
  // onprem → openai の既定/安価モデルを引く（auto は無し）。
  const rpForModels = realProvider(provider);
  const defaultModel =
    view && rpForModels !== "auto" ? view.defaultModels[rpForModels] : "";
  const cheapModel =
    view && rpForModels !== "auto" ? view.cheapModels[rpForModels] : "";

  // ウィンドウ（アプリ窓の中身）いっぱいに被せる全画面表示。OSのディスプレイ
  // 全画面ではない。中央モーダルだと max-w-lg で狭かったため、メール画面を
  // 上書きして広く使う。閉じるは X / Esc（MailApp 側で Esc→onClose）。
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      <div className="flex h-full w-full flex-col overflow-hidden bg-surface">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <KeyRound className="size-4 text-accent" />
          <h2 className="text-sm font-semibold">{t("conn.header")}</h2>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        {loading ? (
          <div className="grid place-items-center py-16 text-fg-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          // 広い画面では2カラム（左=接続: メール＋AI、右=動作/通知/署名/文体/連携）、
          // lg 未満では1カラムに自動フォールバック。items-start で左右を上揃え。
          <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 grid-cols-1 gap-x-8 gap-y-4 overflow-y-auto px-5 py-6 lg:grid-cols-2 lg:items-start">
            {/* 左カラム: 接続（まずメールを繋ぐ→次にAI）。多アカウント対応
                （docs/11 Phase 2）: アカウント一覧＋追加/削除。 */}
            <div className="flex min-w-0 flex-col gap-4">
            <AccountsSection />
            <div className="flex items-center gap-2 border-t border-border pt-4">
              <Sparkles className="size-4 text-accent" />
              <h3 className="text-xs font-semibold">{t("conn.byok")}</h3>
            </div>
            {/* Provider */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">
                {t("conn.provider.label")}
              </span>
              {/* 本命をカード選択に。どれが最優先か一目で分かる（ドロップダウンは
                  開かないと中身が見えず「本命がどれか」が埋もれていた）。 */}
              <div role="radiogroup" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {PROVIDER_OPTIONS.map((o) => {
                  const selected = provider === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => selectProvider(o.value)}
                      className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-accent bg-accent-soft/40 ring-1 ring-accent"
                          : "border-border bg-bg hover:bg-surface-2"
                      }`}
                    >
                      <span className="text-sm font-medium">
                        {o.label ?? t(o.labelKey!)}
                      </span>
                      <span className="text-[11px] leading-snug text-fg-subtle">
                        {t(o.hintKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* 優先関係を1行で明示: 本命＝選んだプロバイダ、予備＝オンプレ停止時のみ。 */}
              <span className="text-[11px] text-fg-subtle">
                {t("conn.active.label")}:{" "}
                <span className="font-medium text-fg-muted">{activeSummary}</span>
              </span>
            </div>

            {/* API key (per selected provider) */}
            {keyProvider ? (
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                  {t("conn.apiKey")}
                  {currentKeyStatus?.set && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                      {t("conn.keySet").replace(
                        "{last4}",
                        currentKeyStatus.last4 ?? "",
                      )}
                    </span>
                  )}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={keyInputs[keyProvider] ?? ""}
                  onChange={(e) =>
                    setKeyInputs((k) => ({
                      ...k,
                      [keyProvider]: e.target.value,
                    }))
                  }
                  placeholder={
                    currentKeyStatus?.set
                      ? t("conn.keyPlaceholder.change")
                      : KEY_PLACEHOLDER[keyProvider]
                  }
                  className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                {currentKeyStatus?.set && (
                  <button
                    type="button"
                    onClick={() =>
                      setKeyInputs((k) => ({ ...k, [keyProvider]: "" }))
                    }
                    className="self-start text-[11px] text-fg-subtle underline hover:text-high"
                  >
                    {t("conn.keyClear")}
                  </button>
                )}
                <span className="text-[11px] text-fg-subtle">
                  {t("conn.keyLocal")}
                </span>
              </label>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-fg-subtle">
                {provider === "gateway"
                  ? t("conn.gatewayNote")
                  : t("conn.autoNote")}
              </p>
            )}

            {/* Model */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">
                {t("conn.model")}
              </span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={
                  defaultModel
                    ? t("conn.model.default").replace("{model}", defaultModel)
                    : t("conn.model.placeholder")
                }
                className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              />
              <span className="text-[11px] text-fg-subtle">
                {t("conn.model.note")}
                {selectedOpt ? "" : ""}
              </span>
            </label>

            {/* Custom endpoint (OpenAI-compatible) — e.g. on-prem Ollama /v1.
                Shown for the dedicated "onprem" choice (primary) and cloud
                "openai" (power users who proxy it). */}
            {(provider === "onprem" || provider === "openai") && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">
                  {t("conn.endpoint")}
                </span>
                <input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    // The typed endpoint changed → prior check/list is stale.
                    setEndpointStatus(null);
                    setEndpointModels(null);
                  }}
                  placeholder={t("conn.endpoint.placeholder")}
                  className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                {/* モデル取得＝接続確認（①②）。落ちてると「未接続」で分かる。 */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!baseUrl.trim() || fetchingModels}
                    onClick={fetchEndpointModels}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {fetchingModels && (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    {fetchingModels
                      ? t("conn.endpoint.fetching")
                      : t("conn.endpoint.fetch")}
                  </button>
                  {endpointStatus && (
                    <span
                      className={`text-[11px] ${endpointStatus.ok ? "text-emerald-600" : "text-rose-600"}`}
                      aria-live="polite"
                    >
                      {endpointStatus.ok ? "✅ " : "⚠️ "}
                      {endpointStatus.msg}
                    </span>
                  )}
                </div>
                {endpointModels && endpointModels.length > 0 && (
                  <select
                    value={endpointModels.includes(model) ? model : ""}
                    onChange={(e) => e.target.value && setModel(e.target.value)}
                    className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                  >
                    <option value="">{t("conn.endpoint.pick")}</option>
                    {endpointModels.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-[11px] text-fg-subtle">
                  {t("conn.endpoint.note")}
                </span>
                {/* オンプレ断時のフォールバック先（opt-in・既定なし）。選ぶと本文が
                    クラウドに出るため、発動時は PII マスクが強制される。 */}
                <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-border/70 bg-surface/50 p-2">
                  <span className="text-xs font-medium text-fg-muted">
                    {t("conn.fallback.label")}
                  </span>
                  <select
                    value={fallbackProvider}
                    onChange={(e) =>
                      setFallbackProvider(
                        e.target.value as "none" | AIProvider,
                      )
                    }
                    className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    <option value="none">{t("conn.fallback.none")}</option>
                    <option value="anthropic">Claude (Anthropic)</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="gateway">Vercel AI Gateway</option>
                  </select>
                  <span className="text-[11px] text-fg-subtle">
                    {t("conn.fallback.note")}
                  </span>
                </div>
              </div>
            )}

            {/* Judgment model — cheap model for 朝の一凪 / 重要度判定 */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">
                {t("conn.judge")}
              </span>
              <div className="flex items-center gap-2">
                <input
                  value={judgmentModel}
                  onChange={(e) => setJudgmentModel(e.target.value)}
                  placeholder={
                    cheapModel
                      ? t("conn.judge.placeholder.cheap").replace(
                          "{model}",
                          cheapModel,
                        )
                      : t("conn.judge.placeholder.same")
                  }
                  className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                {cheapModel && (
                  <button
                    type="button"
                    onClick={() => setJudgmentModel(cheapModel)}
                    className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs text-fg-muted hover:border-accent hover:text-accent"
                  >
                    {t("conn.judge.useCheap")}
                  </button>
                )}
              </div>
              <span className="text-[11px] text-fg-subtle">
                {t("conn.judge.note.a")}
                <strong>{t("conn.judge.note.b")}</strong>
                {t("conn.judge.note.c")}
              </span>
            </label>

            {/* Jev（分類専用モデル）— 設定すると重要度/脅威/朝の一凪の分類を Jev に。
                接続口は TypeSafe 直 / OpenRouter 経由（既存キー再利用）を選べる。 */}
            <label className="flex flex-col gap-1.5 rounded-xl border border-border bg-bg px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                {t("conn.jev")}
              </span>

              {/* 接続口セレクタ（変更は即保存） */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-fg-subtle">
                  {t("conn.jev.ep.label")}
                </span>
                {(["typesafe", "openrouter"] as const).map((ep) => {
                  const on = (view?.jevEndpoint ?? "typesafe") === ep;
                  return (
                    <button
                      key={ep}
                      type="button"
                      onClick={async () => {
                        const res = await fetch("/api/settings/ai", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ jevEndpoint: ep }),
                        });
                        if (res.ok) setView((await res.json()) as View);
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-fg-muted hover:border-fg-subtle"
                      }`}
                    >
                      {t(`conn.jev.ep.${ep}`)}
                    </button>
                  );
                })}
              </div>

              {(view?.jevEndpoint ?? "typesafe") === "openrouter" ? (
                <span className="text-[11px] leading-relaxed text-fg-subtle">
                  {t("conn.jev.ep.openrouter.note")}{" "}
                  {view?.keys.openrouter.set ? (
                    <span className="text-emerald-600">
                      {t("conn.jev.ep.openrouter.haskey")}
                    </span>
                  ) : (
                    <span className="text-high">
                      {t("conn.jev.ep.openrouter.needkey")}
                    </span>
                  )}
                </span>
              ) : (
                <>
                  {view?.jevKey.set && (
                    <span className="self-start rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                      {t("conn.keySet").replace(
                        "{last4}",
                        view.jevKey.last4 ?? "",
                      )}
                    </span>
                  )}
                  <input
                    type="password"
                    autoComplete="off"
                    value={jevKeyInput ?? ""}
                    onChange={(e) => setJevKeyInput(e.target.value)}
                    placeholder={
                      view?.jevKey.set
                        ? t("conn.keyPlaceholder.change")
                        : "ts-... (TypeSafe API key)"
                    }
                    className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                  />
                  {view?.jevKey.set && (
                    <button
                      type="button"
                      onClick={() => setJevKeyInput("")}
                      className="self-start text-[11px] text-fg-subtle underline hover:text-high"
                    >
                      {t("conn.keyClear")}
                    </button>
                  )}
                </>
              )}
              <span className="text-[11px] leading-relaxed text-fg-subtle">
                {t("conn.jev.note")}
              </span>
            </label>

            {/* Jev プレイグラウンド（Claude と比較・sandbox） */}
            <JevPlayground />

            {/* Active status */}
            {view && (
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-fg-muted">
                {t("conn.active.current")}
                <span className="font-mono">
                  {view.active.provider}:{view.active.model}
                </span>{" "}
                {view.active.configured ? (
                  <span className="text-emerald-600">
                    {t("conn.active.ok").replace(
                      "{source}",
                      view.active.source,
                    )}
                  </span>
                ) : (
                  <span className="text-high">{t("conn.active.noKey")}</span>
                )}
                {view.active.judgmentModel !== view.active.model && (
                  <span className="mt-0.5 block">
                    {t("conn.active.judge")}
                    <span className="font-mono">
                      {view.active.judgmentModel}
                    </span>
                  </span>
                )}
              </div>
            )}

            {/* Test result */}
            {test && (
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                  test.ok
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-high-soft text-high"
                }`}
              >
                {test.ok ? (
                  <Check className="size-4" />
                ) : (
                  <AlertCircle className="size-4" />
                )}
                <span className="break-all">{test.msg}</span>
              </div>
            )}

            <label className="flex items-start gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
              <input
                type="checkbox"
                checked={view?.piiMask ?? true}
                onChange={async (e) => {
                  const piiMask = e.target.checked;
                  const res = await fetch("/api/settings/ai", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ piiMask }),
                  });
                  if (res.ok) setView((await res.json()) as View);
                }}
                className="mt-0.5 size-4 accent-[var(--accent,#6d5ae6)]"
              />
              <span className="flex flex-col gap-0.5 text-xs">
                <span className="font-medium">{t("conn.pii.title")}</span>
                <span className="text-[11px] leading-relaxed text-fg-subtle">
                  {t("conn.pii.note.a")}
                  <code>[EMAIL_1]</code>
                  {t("conn.pii.note.b")}
                </span>
              </span>
            </label>

            <label
              className={`flex items-start gap-2 rounded-xl border border-border bg-bg px-3 py-2.5 ${
                view?.piiMask === false ? "opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={view?.nerMask ?? false}
                disabled={view?.piiMask === false}
                onChange={async (e) => {
                  const nerMask = e.target.checked;
                  const res = await fetch("/api/settings/ai", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ nerMask }),
                  });
                  if (res.ok) setView((await res.json()) as View);
                }}
                className="mt-0.5 size-4 accent-[var(--accent,#6d5ae6)]"
              />
              <span className="flex flex-col gap-0.5 text-xs">
                <span className="font-medium">{t("conn.ner.title")}</span>
                <span className="text-[11px] leading-relaxed text-fg-subtle">
                  {t("conn.ner.note.a")}
                  <code>[NAME_1]</code>・<code>[ORG_1]</code>
                  {t("conn.ner.note.b")}
                  <strong>{t("conn.ner.note.strong")}</strong>
                  {t("conn.ner.note.c")}
                </span>
              </span>
            </label>

            {/* AI(BYOK) の操作: 接続テスト＋この AI 設定の保存（このブロック専用）。 */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleTest}
                disabled={loading || saving || testing}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
              >
                {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t("conn.test.btn")}
              </button>
              <button
                onClick={handleSave}
                disabled={loading || saving || testing}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t("conn.save")}
              </button>
            </div>
            </div>

            {/* 右カラム: 動作・通知・使用量・署名・文体・連携。 */}
            <div className="flex min-w-0 flex-col gap-4">
            <SweepAutoSection />

            <NotifySection />

            <MailNotifySection />

            <DownloadSection />

            <AiUsageSection />

            <ReplySignatureSection />

            <WritingNoteSection />

            <WritingSamplesSection />

            <OpenProjectSection />

            <DevlogSection />

            <NextcloudSection />

            <ObsidianSection />

            <TeamRulesSection />
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <button
            onClick={handleSave}
            disabled={loading || saving || testing}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("conn.saveAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * OS 通知（期限TODOのリマインドをデスクトップのトーストで）。端末ごとの好みなので
 * localStorage（@/lib/notify-prefs）。ONにしたら通知権限を要求する。
 */
function NotifySection() {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean>(getOsNotify);
  const [denied, setDenied] = useState(false);
  if (!notifySupported()) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const next = e.target.checked;
          if (next) {
            const ok = await ensureNotifyPermission();
            setDenied(!ok);
            if (!ok) return; // 権限が無ければ ON にしない
          }
          setOsNotify(next);
          setOn(next);
        }}
        className="mt-0.5 size-4 accent-[var(--accent,#6d5ae6)]"
      />
      <span className="flex flex-col gap-0.5 text-xs">
        <span className="font-medium">{t("notify.title")}</span>
        <span className="text-[11px] leading-relaxed text-fg-subtle">
          {t("notify.desc")}
        </span>
        {denied && (
          <span className="text-[11px] text-high">{t("notify.denied")}</span>
        )}
      </span>
    </div>
  );
}

/**
 * 新着メールの OS 通知（アプリを開いている間、受信箱に新着が来たら通知）。期限TODOの
 * リマインドとは別トグル。端末ごとの好みなので localStorage（@/lib/notify-prefs）。
 */
function MailNotifySection() {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean>(getMailNotify);
  const [important, setImportant] = useState<boolean>(getImportantOnly);
  const [denied, setDenied] = useState(false);
  if (!notifySupported()) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={on}
          onChange={async (e) => {
            const next = e.target.checked;
            if (next) {
              const ok = await ensureNotifyPermission();
              setDenied(!ok);
              if (!ok) return; // 権限が無ければ ON にしない
            }
            setMailNotify(next);
            setOn(next);
          }}
          className="mt-0.5 size-4 accent-[var(--accent,#6d5ae6)]"
        />
        <span className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">{t("mailNotify.title")}</span>
          <span className="text-[11px] leading-relaxed text-fg-subtle">
            {t("mailNotify.desc")}
          </span>
          {denied && (
            <span className="text-[11px] text-high">{t("notify.denied")}</span>
          )}
        </span>
      </label>
      {on && (
        <label className="flex items-start gap-2 pl-6">
          <input
            type="checkbox"
            checked={important}
            onChange={(e) => {
              setImportantOnly(e.target.checked);
              setImportant(e.target.checked);
            }}
            className="mt-0.5 size-4 accent-[var(--accent,#6d5ae6)]"
          />
          <span className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium">{t("mailNotify.importantTitle")}</span>
            <span className="text-[11px] leading-relaxed text-fg-subtle">
              {t("mailNotify.importantDesc")}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * 朝の一凪（morning sweep）の自動表示モード設定（表示しない / 朝だけ / 常に）。
 * 端末ごとの表示タイミングの好みなので localStorage 保存（@/lib/sweep-prefs）。
 */
function SweepAutoSection() {
  const { t } = useI18n();
  // Lazy init: getSweepAutoMode is localStorage-safe (try/catch → default on
  // server / no storage), so read it once during the first client render.
  const [mode, setMode] = useState<SweepAutoMode>(getSweepAutoMode);
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
      <span className="flex flex-1 flex-col gap-1 text-xs">
        <span className="font-medium">{t("conn.sweep.title")}</span>
        <span className="text-[11px] leading-relaxed text-fg-subtle">
          {t("conn.sweep.desc")}
        </span>
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value as SweepAutoMode;
            setMode(next);
            setSweepAutoMode(next);
          }}
          className="mt-1 w-fit rounded-lg border border-border bg-bg px-2 py-1 text-xs"
        >
          <option value="off">{t("conn.sweep.off")}</option>
          <option value="morning">{t("conn.sweep.morning")}</option>
          <option value="always">{t("conn.sweep.always")}</option>
        </select>
      </span>
    </div>
  );
}

/**
 * Local AI usage log — input/output tokens per call so the cost is visible.
 * Token counts come from the providers' own usage reports; currency cost is
 * the provider dashboard's job (prices vary by model/plan, we don't guess).
 */
function AiUsageSection() {
  const { t } = useI18n();
  const [stats, setStats] = useState<{
    total: { calls: number; inputTokens: number; outputTokens: number };
    recent: { calls: number; inputTokens: number; outputTokens: number };
    byModel: {
      model: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      estUsd?: number;
    }[];
    byKind: {
      kind: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      estUsd?: number;
    }[];
    totalEstUsd?: number | null;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai/usage");
        setStats(await res.json());
      } catch {
        /* stats are informational */
      }
    })();
  }, []);

  if (!stats || stats.total.calls === 0) return null;
  const fmt = (n: number) => n.toLocaleString();
  const usd = (n: number) =>
    n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
  const kindLabel = (kind: string) => {
    const k = t(`conn.usage.kind.${kind}`);
    return k === `conn.usage.kind.${kind}` ? kind : k;
  };

  return (
    <div className="border-t border-border pt-4">
      <p className="text-xs font-semibold">{t("conn.usage.title")}</p>
      <p className="mt-1 text-[11px] text-fg-subtle">
        {t("conn.usage.recent")
          .replace("{rcalls}", fmt(stats.recent.calls))
          .replace("{rin}", fmt(stats.recent.inputTokens))
          .replace("{rout}", fmt(stats.recent.outputTokens))
          .replace("{tcalls}", fmt(stats.total.calls))
          .replace("{tin}", fmt(stats.total.inputTokens))
          .replace("{tout}", fmt(stats.total.outputTokens))}
      </p>
      {typeof stats.totalEstUsd === "number" && (
        <p className="mt-1 text-sm font-semibold text-fg">
          {t("conn.usage.est")}
          {usd(stats.totalEstUsd)}
          <span className="ml-1.5 text-[10px] font-normal text-fg-subtle">
            {t("conn.usage.estNote")}
          </span>
        </p>
      )}
      <div className="mt-2 space-y-0.5">
        {stats.byKind.map((k) => (
          <p
            key={k.kind}
            className="flex justify-between text-[11px] text-fg-muted"
          >
            <span>{kindLabel(k.kind)}</span>
            <span className="tabular-nums">
              {t("conn.usage.rowKind")
                .replace("{calls}", fmt(k.calls))
                .replace("{in}", fmt(k.inputTokens))
                .replace("{out}", fmt(k.outputTokens))}
              {typeof k.estUsd === "number" ? ` ≈ ${usd(k.estUsd)}` : ""}
            </span>
          </p>
        ))}
        {stats.byModel.map((m) => (
          <p
            key={m.model}
            className="flex justify-between text-[11px] text-fg-subtle"
          >
            <span className="truncate">{m.model}</span>
            <span className="shrink-0 tabular-nums">
              {t("conn.usage.rowModel")
                .replace("{in}", fmt(m.inputTokens))
                .replace("{out}", fmt(m.outputTokens))}
              {typeof m.estUsd === "number" ? ` ≈ ${usd(m.estUsd)}` : ""}
            </span>
          </p>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-fg-subtle">
        {t("conn.usage.foot.a")}
        <a
          className="underline"
          href="https://openrouter.ai/api/v1/models"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("conn.usage.foot.link")}
        </a>
        {t("conn.usage.foot.b")}
      </p>
    </div>
  );
}

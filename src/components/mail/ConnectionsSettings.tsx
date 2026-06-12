"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Check, AlertCircle, KeyRound, Sparkles } from "lucide-react";
import type { AIProvider } from "@/lib/types";
import { EmailConnectSection } from "./EmailConnectSection";

type ProviderChoice = AIProvider | "auto";

interface KeyStatus {
  set: boolean;
  last4?: string;
}

interface View {
  provider: ProviderChoice;
  model: string;
  keys: Record<AIProvider, KeyStatus>;
  defaultModels: Record<AIProvider, string>;
  active: { provider: AIProvider; model: string; configured: boolean; source: "settings" | "env" };
}

const PROVIDER_OPTIONS: { value: ProviderChoice; label: string; hint: string; needsKey: boolean }[] = [
  { value: "openrouter", label: "OpenRouter", hint: "1キーで多モデル（推奨）", needsKey: true },
  { value: "anthropic", label: "Claude (Anthropic)", hint: "Claude を直接", needsKey: true },
  { value: "openai", label: "OpenAI", hint: "GPT 系", needsKey: true },
  { value: "gateway", label: "Vercel AI Gateway", hint: "キーは環境変数/OIDC", needsKey: false },
  { value: "auto", label: "自動検出", hint: "設定済みキーから自動選択", needsKey: false },
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("openrouter");
  const [model, setModel] = useState("");
  // Keys the user typed this session (per provider). Empty string = clear.
  const [keyInputs, setKeyInputs] = useState<Partial<Record<AIProvider, string>>>({});
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setTest(null);
    try {
      const res = await fetch("/api/settings/ai");
      const data = (await res.json()) as View;
      setView(data);
      // Default the picker to OpenRouter on a pristine ("auto") state so the
      // key field is visible immediately; "auto" stays selectable explicitly.
      setProvider(data.provider && data.provider !== "auto" ? data.provider : "openrouter");
      setModel(data.model ?? "");
      setKeyInputs({});
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
  const keyProvider: AIProvider | null =
    provider !== "auto" && provider !== "gateway" ? provider : null;

  async function persist(): Promise<View | null> {
    const keys: Partial<Record<AIProvider, string>> = {};
    for (const [k, v] of Object.entries(keyInputs)) {
      if (v !== undefined) keys[k as AIProvider] = v;
    }
    const res = await fetch("/api/settings/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, keys }),
    });
    const data = (await res.json()) as View & { ok: boolean };
    setView(data);
    setKeyInputs({});
    onSaved(data.active.configured);
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
      const data = (await res.json()) as { ok: boolean; label?: string; sample?: string; error?: string };
      setTest(
        data.ok
          ? { ok: true, msg: `接続OK — ${data.label}` }
          : { ok: false, msg: data.error ?? "接続テストに失敗しました" },
      );
    } catch {
      setTest({ ok: false, msg: "接続テストに失敗しました" });
    } finally {
      setTesting(false);
    }
  }

  const currentKeyStatus = keyProvider ? view?.keys[keyProvider] : undefined;
  const defaultModel = view && provider !== "auto" ? view.defaultModels[provider] : "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <KeyRound className="size-4 text-accent" />
          <h2 className="text-sm font-semibold">接続設定（AI・メール）</h2>
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
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h3 className="text-xs font-semibold">AI（BYOK）</h3>
            </div>
            {/* Provider */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">プロバイダ</span>
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as ProviderChoice);
                  setTest(null);
                }}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {PROVIDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} — {o.hint}
                  </option>
                ))}
              </select>
            </label>

            {/* API key (per selected provider) */}
            {keyProvider ? (
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                  API キー
                  {currentKeyStatus?.set && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                      設定済み ••••{currentKeyStatus.last4}
                    </span>
                  )}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={keyInputs[keyProvider] ?? ""}
                  onChange={(e) =>
                    setKeyInputs((k) => ({ ...k, [keyProvider]: e.target.value }))
                  }
                  placeholder={
                    currentKeyStatus?.set ? "変更する場合のみ入力" : KEY_PLACEHOLDER[keyProvider]
                  }
                  className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                {currentKeyStatus?.set && (
                  <button
                    type="button"
                    onClick={() => setKeyInputs((k) => ({ ...k, [keyProvider]: "" }))}
                    className="self-start text-[11px] text-fg-subtle underline hover:text-high"
                  >
                    保存済みキーをクリア
                  </button>
                )}
                <span className="text-[11px] text-fg-subtle">
                  キーはこの端末のローカル（.data）にのみ保存されます。
                </span>
              </label>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-fg-subtle">
                {provider === "gateway"
                  ? "Gateway のキーは環境変数（AI_GATEWAY_API_KEY / OIDC）で設定します。"
                  : "設定済みのキーから自動でプロバイダを選びます。"}
              </p>
            )}

            {/* Model */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">モデル ID（任意）</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={defaultModel ? `既定: ${defaultModel}` : "プロバイダの現行モデルIDを指定"}
                className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              />
              <span className="text-[11px] text-fg-subtle">
                モデルIDは変わります。空欄なら既定値を使用。{selectedOpt ? "" : ""}
              </span>
            </label>

            {/* Active status */}
            {view && (
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-fg-muted">
                現在の有効設定: <span className="font-mono">{view.active.provider}:{view.active.model}</span>{" "}
                {view.active.configured ? (
                  <span className="text-emerald-600">（接続可・{view.active.source}）</span>
                ) : (
                  <span className="text-high">（キー未設定）</span>
                )}
              </div>
            )}

            {/* Test result */}
            {test && (
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                  test.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-high-soft text-high"
                }`}
              >
                {test.ok ? <Check className="size-4" /> : <AlertCircle className="size-4" />}
                <span className="break-all">{test.msg}</span>
              </div>
            )}

            <AiUsageSection />

            <div className="border-t border-border pt-4">
              <EmailConnectSection />
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <button
            onClick={handleTest}
            disabled={loading || saving || testing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            AI 接続テスト
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saving || testing}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            AI 設定を保存
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Local AI usage log — input/output tokens per call so the cost is visible.
 * Token counts come from the providers' own usage reports; currency cost is
 * the provider dashboard's job (prices vary by model/plan, we don't guess).
 */
function AiUsageSection() {
  const [stats, setStats] = useState<{
    total: { calls: number; inputTokens: number; outputTokens: number };
    recent: { calls: number; inputTokens: number; outputTokens: number };
    byModel: { model: string; calls: number; inputTokens: number; outputTokens: number }[];
    byKind: { kind: string; calls: number; inputTokens: number; outputTokens: number }[];
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
  const fmt = (n: number) => n.toLocaleString("ja-JP");
  const KIND_LABEL: Record<string, string> = {
    reply: "返信生成",
    suggest: "添削",
    classify: "重要度判定",
  };

  return (
    <div className="border-t border-border pt-4">
      <p className="text-xs font-semibold">AI 使用量（この端末のログ）</p>
      <p className="mt-1 text-[11px] text-fg-subtle">
        直近30日: {fmt(stats.recent.calls)}回・入力 {fmt(stats.recent.inputTokens)} / 出力{" "}
        {fmt(stats.recent.outputTokens)} トークン（累計 {fmt(stats.total.calls)}回・入力{" "}
        {fmt(stats.total.inputTokens)} / 出力 {fmt(stats.total.outputTokens)}）
      </p>
      <div className="mt-2 space-y-0.5">
        {stats.byKind.map((k) => (
          <p key={k.kind} className="flex justify-between text-[11px] text-fg-muted">
            <span>{KIND_LABEL[k.kind] ?? k.kind}</span>
            <span className="tabular-nums">
              {fmt(k.calls)}回 / in {fmt(k.inputTokens)} / out {fmt(k.outputTokens)}
            </span>
          </p>
        ))}
        {stats.byModel.map((m) => (
          <p key={m.model} className="flex justify-between text-[11px] text-fg-subtle">
            <span className="truncate">{m.model}</span>
            <span className="shrink-0 tabular-nums">
              in {fmt(m.inputTokens)} / out {fmt(m.outputTokens)}
            </span>
          </p>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-fg-subtle">
        金額はプロバイダのダッシュボード（OpenRouter等）で確認してください（単価はモデル・プランで変動するため）。
      </p>
    </div>
  );
}

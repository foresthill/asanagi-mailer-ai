/**
 * 朝の一凪（morning sweep）の自動表示プリファレンス。
 *
 * 受信箱を開いた直後にポップアップを出すかどうかの UI 設定。純粋な表示タイミングの
 * 好みで端末ごとに閉じていてよく（local-first・単一端末）、既存の sweep スロットル
 * (`asanagi:last-sweep`) と同じく localStorage に置く。同期読み取りなので受信箱表示を
 * ブロックしない（急ぎのときにワンテンポ待たされない）。
 */

export type SweepAutoMode = "off" | "morning" | "always";

const KEY = "asanagi:sweep-auto-mode";

/** 既定は「朝だけ」= 機能名（朝の一凪）どおりの挙動。手動ボタンは常に使える。 */
export const DEFAULT_SWEEP_AUTO_MODE: SweepAutoMode = "morning";

export function getSweepAutoMode(): SweepAutoMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "off" || v === "morning" || v === "always") return v;
  } catch {
    // localStorage 不可（プライベートウィンドウ等）→ 既定へ。
  }
  return DEFAULT_SWEEP_AUTO_MODE;
}

export function setSweepAutoMode(mode: SweepAutoMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // 保存できなくても致命的ではない（次回また既定）。
  }
}

/** 朝の時間帯か（ローカル時刻 4:00–10:59）。 */
export function isMorningHour(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h >= 4 && h < 11;
}

/**
 * このモード・時刻で自動表示を許可してよいか。
 * スロットル（12h）や未さばき件数の判定は呼び出し側に残す。
 */
export function sweepAutoAllowed(
  mode: SweepAutoMode,
  now: Date = new Date(),
): boolean {
  if (mode === "off") return false;
  if (mode === "morning") return isMorningHour(now);
  return true; // always
}

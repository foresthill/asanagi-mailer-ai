/**
 * OS 通知（デスクトップのトースト）の設定と発火。Web Notification API を使う
 * （ブラウザ／Tauri の webview 両対応）。端末ごとの好みなので localStorage。
 * 権限が無い・未対応・OFF のときは静かに何もしない（アプリ内のリマインドバナーは
 * 従来どおり出る）。macOS の「リマインダー」アプリ登録は別物（カレンダー登録を使う）。
 */

const KEY = "asanagi:os-notify";

export function getOsNotify(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setOsNotify(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** 設定ONのとき権限を要求する。付与できたら true。 */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!notifySupported()) return false;
  try {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

/** 設定ON＆権限ありのときだけ OS 通知を出す。失敗は握りつぶす。 */
export function fireNotification(title: string, body?: string): void {
  if (!getOsNotify() || !notifySupported()) return;
  try {
    if (Notification.permission !== "granted") return;
    new Notification(title, body ? { body } : undefined);
  } catch {
    /* ignore — the in-app reminder banner still shows */
  }
}

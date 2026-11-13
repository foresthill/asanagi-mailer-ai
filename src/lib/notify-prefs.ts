/**
 * OS 通知（デスクトップのトースト）の設定と発火。Web Notification API を使う
 * （ブラウザ／Tauri の webview 両対応）。端末ごとの好みなので localStorage。
 * 権限が無い・未対応・OFF のときは静かに何もしない（アプリ内のリマインドバナーは
 * 従来どおり出る）。macOS の「リマインダー」アプリ登録は別物（カレンダー登録を使う）。
 */

const KEY = "asanagi:os-notify";
const MAIL_KEY = "asanagi:mail-notify";

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

/** 新着メールの OS 通知（期限TODOのリマインドとは別トグル）。 */
export function getMailNotify(): boolean {
  try {
    return localStorage.getItem(MAIL_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMailNotify(on: boolean): void {
  try {
    localStorage.setItem(MAIL_KEY, on ? "1" : "0");
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

/** 対応＆権限ありのとき OS 通知を出す低レベル関数（トグル判定は呼び出し側）。 */
export function notify(title: string, body?: string): void {
  if (!notifySupported()) return;
  try {
    if (Notification.permission !== "granted") return;
    new Notification(title, body ? { body } : undefined);
  } catch {
    /* ignore — the in-app reminder banner still shows */
  }
}

/** 期限TODOリマインドの OS 通知（設定ONのときだけ）。失敗は握りつぶす。 */
export function fireNotification(title: string, body?: string): void {
  if (!getOsNotify()) return;
  notify(title, body);
}

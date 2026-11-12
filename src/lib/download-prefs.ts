/**
 * 添付ダウンロードの保存設定。端末ごとの好みなので localStorage（@/lib/notify-prefs
 * と同方針）。デスクトップ(Tauri)でのみ意味を持つ：
 * - ask=true（既定）: 保存のたびにネイティブ保存ダイアログ（場所と名前を選ぶ）
 * - ask=false: 既定フォルダへ即保存（dir 空なら OS のダウンロードフォルダ）
 * ブラウザはブラウザ自身のダウンロード先に従うため、この設定は無視される。
 */

const ASK_KEY = "asanagi:download-ask";
const DIR_KEY = "asanagi:download-dir";

/** True = 保存時に毎回ダイアログを出す（既定）。 */
export function getDownloadAsk(): boolean {
  try {
    // 既定は true。明示的に "0" のときだけ OFF。
    return localStorage.getItem(ASK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setDownloadAsk(ask: boolean): void {
  try {
    localStorage.setItem(ASK_KEY, ask ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** 既定の保存先フォルダ。空文字＝OS のダウンロードフォルダを使う。 */
export function getDownloadDir(): string {
  try {
    return localStorage.getItem(DIR_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDownloadDir(dir: string): void {
  try {
    if (dir) localStorage.setItem(DIR_KEY, dir);
    else localStorage.removeItem(DIR_KEY);
  } catch {
    /* ignore */
  }
}

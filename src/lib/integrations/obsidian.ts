import { promises as fs } from "node:fs";
import path from "node:path";
import type { Email, EmailAddress, ObsidianSettings } from "@/lib/types";

/**
 * Obsidian 連携（ローカル vault への Markdown 書き出し）。
 *
 * Obsidian の vault はただのローカルフォルダなので、プラグインもネットワークも不要で、
 * メール1通を Markdown ノートとして vault 内のサブフォルダに保存するだけ。
 *
 * local-first: 本文は端末外に出ない。ユーザーが明示的に「Obsidian に保存」を押したときだけ、
 * 同じ端末上の vault フォルダへ書き込む。接続情報（vault パス・保存先フォルダ）は .data の
 * みに保存する（資格情報ではないが端末内の情報なので外には出さない）。
 */

/** 既定の保存先サブフォルダ（vault 直下に散らからないように）。 */
export const DEFAULT_OBSIDIAN_FOLDER = "Asanagi";

export function isObsidianConfigured(s: ObsidianSettings): boolean {
  return !!s.vaultPath?.trim();
}

/**
 * 保存先サブフォルダを正規化する。前後のスラッシュを除去し、`..`（上位への脱出）を含む
 * 指定は既定フォルダに倒す（vault の外へ書き込ませない安全策）。空欄も既定へ。
 */
export function normalizeFolder(raw?: string): string {
  const cleaned = (raw ?? "").trim().replace(/^[/\\]+|[/\\]+$/g, "");
  if (!cleaned || cleaned.split(/[/\\]/).some((seg) => seg === "..")) {
    return DEFAULT_OBSIDIAN_FOLDER;
  }
  return cleaned;
}

/** vault パスが実在するディレクトリか（接続バッジ用）。 */
export async function vaultExists(vaultPath?: string): Promise<boolean> {
  const p = vaultPath?.trim();
  if (!p) return false;
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** ファイル名に使えない文字を安全化（fs の禁止文字 + Obsidian リンクの特殊文字）。 */
function safeFileName(raw: string): string {
  const base = (raw || "無題")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return base || "無題";
}

/** 二重引用符 YAML スカラー用のエスケープ。 */
function yamlEscape(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fmtAddr(a?: EmailAddress): string {
  if (!a) return "";
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/** メール1通を Markdown（YAML frontmatter + 本文）に整形。 */
export function renderNote(email: Email): string {
  const subject = email.subject || "（件名なし）";
  const to = (email.to ?? []).map(fmtAddr).filter(Boolean).join(", ");
  const fm = [
    "---",
    `title: ${yamlEscape(subject)}`,
    `from: ${yamlEscape(fmtAddr(email.from))}`,
    to ? `to: ${yamlEscape(to)}` : "",
    `date: ${yamlEscape(email.date ?? "")}`,
    email.messageId ? `message-id: ${yamlEscape(email.messageId)}` : "",
    `source: ${yamlEscape("Asanagi")}`,
    "tags: [asanagi/mail]",
    "---",
  ]
    .filter(Boolean)
    .join("\n");
  const body = (email.body ?? email.snippet ?? "").trim();
  return `${fm}\n\n# ${subject}\n\n${body}\n`;
}

/**
 * メールを vault 内のノートとして保存。戻り値は保存した絶対パスと vault 相対パス。
 * ファイル名は「YYYY-MM-DD 件名.md」。同名があれば番号を付けて衝突回避（上書きしない）。
 */
export async function saveNote(
  s: ObsidianSettings,
  email: Email,
): Promise<{ absPath: string; relPath: string }> {
  const vaultPath = s.vaultPath?.trim();
  if (!vaultPath) throw new Error("vault パスが未設定です。");
  const st = await fs.stat(vaultPath).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new Error("vault フォルダが見つかりません。パスを確認してください。");
  }

  const folder = normalizeFolder(s.folder);
  const dir = path.join(vaultPath, folder);
  await fs.mkdir(dir, { recursive: true });

  const datePart = (() => {
    const d = new Date(email.date ?? Date.now());
    return Number.isNaN(+d) ? "" : d.toISOString().slice(0, 10);
  })();
  const stem = safeFileName(
    `${datePart ? datePart + " " : ""}${email.subject || "無題"}`,
  );

  // 上書きしない: 同名があれば「… 2.md」「… 3.md」と採番して衝突回避。
  let name = `${stem}.md`;
  for (let n = 2; n <= 999; n++) {
    try {
      await fs.access(path.join(dir, name));
      name = `${stem} ${n}.md`;
    } catch {
      break; // 存在しない → この名前で確定
    }
  }

  const absPath = path.join(dir, name);
  await fs.writeFile(absPath, renderNote(email), "utf8");
  return { absPath, relPath: path.join(folder, name) };
}

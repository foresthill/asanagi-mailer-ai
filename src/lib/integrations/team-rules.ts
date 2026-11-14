import { promises as fs } from "node:fs";
import type { TeamRulesSettings } from "@/lib/types";

/**
 * チーム共有ルール（集合的無意識 / docs/10 Phase 2・案A）のファイル入出力。
 *
 * 共有の実体は、同期フォルダ（Nextcloud/iCloud 等）に置いた team-rules.json という
 * ただのファイル。中身は「抽象的な文体ルール行」の配列だけ（本文・生の差分・PII は一切
 * 入らない）。読み込みはプロンプト合成でマージ（個人ルール > チームルール）、書き戻しは
 * opt-in の「チームに提案」でのみ1行ずつ追記する（自動常駐同期・自動上書きはしない）。
 */

export interface TeamRulesFile {
  rules: string[];
}

export function isTeamRulesConfigured(s: TeamRulesSettings): boolean {
  return !!s.filePath?.trim();
}

/** 共有ファイルが実在するか（接続バッジ用）。未作成（これから提案で作る）も configured。 */
export async function teamRulesFileExists(filePath?: string): Promise<boolean> {
  const p = filePath?.trim();
  if (!p) return false;
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * 共有ファイルからルール行を読む。best-effort: 未設定・未作成・壊れたJSON は [] を返す
 * （共有は任意機能で、読めなくても返信生成を止めない）。
 */
export async function readTeamRules(s: TeamRulesSettings): Promise<string[]> {
  const p = s.filePath?.trim();
  if (!p) return [];
  try {
    const raw = await fs.readFile(p, "utf8");
    const data = JSON.parse(raw) as Partial<TeamRulesFile>;
    const rules = Array.isArray(data.rules) ? data.rules : [];
    // 重複除去＋空行除去＋前後空白の正規化。
    const out: string[] = [];
    for (const r of rules) {
      const line = String(r).trim();
      if (line && !out.includes(line)) out.push(line);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 共有ファイルにルール行を1つ追記する（opt-in「チームに提案」）。重複は追記しない。
 * ファイルが無ければ作成する（親フォルダは存在前提＝同期フォルダ）。戻り値は追記後の一覧。
 */
export async function appendTeamRule(
  s: TeamRulesSettings,
  line: string,
): Promise<string[]> {
  const p = s.filePath?.trim();
  if (!p) throw new Error("共有ファイルのパスが未設定です。");
  const rule = line.trim();
  if (!rule) throw new Error("ルールが空です。");
  const cur = await readTeamRules(s);
  if (cur.includes(rule)) return cur; // 既に共有済み
  const next = [...cur, rule];
  try {
    await fs.writeFile(p, JSON.stringify({ rules: next }, null, 2), "utf8");
  } catch {
    throw new Error(
      "共有ファイルに書き込めませんでした。フォルダのパスと同期状態を確認してください。",
    );
  }
  return next;
}

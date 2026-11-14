"use client";

import type { ProjectParty } from "@/lib/types";

/**
 * 関係者マップ（docs/12 Phase B）: 案件の関係者を「自分 → 組織 → 担当者」の構成図として
 * インライン SVG で描く。描くのは AI が実メールから抽出した `Project.parties` だけで、
 * 架空のノードは足さない（偽機能禁止）。レイアウトは決定論（左→右・組織ごとに1行）。
 * local-first: データは案件オブジェクト内で完結し、どこにも送らない。
 *
 * テーマ対応のため色は globals.css の CSS 変数をインライン指定（light/dark 自動追従）。
 */

const PAD = 8;
const NH = 28; // ノード高
const GAP = 12; // 行間
const SELF_X = 8;
const SELF_W = 60;
const ORG_X = 116;
const ORG_W = 150;
const PERSON_X = 282;
const PERSON_W = 140;

function clip(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function Node({
  x,
  y,
  w,
  label,
  full,
  fill,
  stroke,
  color,
  weight,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  full: string;
  fill: string;
  stroke: string;
  color: string;
  weight?: number;
}) {
  return (
    <g>
      <title>{full}</title>
      <rect
        x={x}
        y={y}
        width={w}
        height={NH}
        rx={8}
        style={{ fill, stroke }}
        strokeWidth={1}
      />
      <text
        x={x + w / 2}
        y={y + NH / 2}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fill: color, fontSize: 11, fontWeight: weight ?? 500 }}
      >
        {label}
      </text>
    </g>
  );
}

export function ProjectPartyGraph({ parties }: { parties: ProjectParty[] }) {
  const rows = parties.filter((p) => (p.org ?? "").trim());
  if (!rows.length) return null;

  const hasPerson = rows.some((p) => (p.person ?? "").trim());
  const totalW = (hasPerson ? PERSON_X + PERSON_W : ORG_X + ORG_W) + 8;
  const totalH = PAD * 2 + rows.length * NH + (rows.length - 1) * GAP;
  const orgY = (i: number) => PAD + i * (NH + GAP);
  const selfY = (totalH - NH) / 2;
  const selfMidY = selfY + NH / 2;

  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      width={totalW}
      height={totalH}
      role="img"
      aria-label="関係者マップ"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      {/* edges: self → each org, org → its person */}
      {rows.map((p, i) => {
        const oMidY = orgY(i) + NH / 2;
        return (
          <g key={`e${i}`}>
            <line
              x1={SELF_X + SELF_W}
              y1={selfMidY}
              x2={ORG_X}
              y2={oMidY}
              style={{ stroke: "var(--border-strong)" }}
              strokeWidth={1}
            />
            {(p.person ?? "").trim() && (
              <line
                x1={ORG_X + ORG_W}
                y1={oMidY}
                x2={PERSON_X}
                y2={oMidY}
                style={{ stroke: "var(--border-strong)" }}
                strokeWidth={1}
              />
            )}
          </g>
        );
      })}

      {/* self node (center-left) */}
      <Node
        x={SELF_X}
        y={selfY}
        w={SELF_W}
        label="自分"
        full="自分"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        color="var(--accent)"
        weight={600}
      />

      {/* org + person nodes */}
      {rows.map((p, i) => (
        <g key={`n${i}`}>
          <Node
            x={ORG_X}
            y={orgY(i)}
            w={ORG_W}
            label={clip(p.org, 13)}
            full={p.org}
            fill="var(--surface)"
            stroke="var(--border)"
            color="var(--fg)"
          />
          {(p.person ?? "").trim() && (
            <Node
              x={PERSON_X}
              y={orgY(i)}
              w={PERSON_W}
              label={clip(p.person!, 10)}
              full={p.person!}
              fill="var(--surface-2)"
              stroke="var(--border)"
              color="var(--fg-muted)"
            />
          )}
        </g>
      ))}
    </svg>
  );
}

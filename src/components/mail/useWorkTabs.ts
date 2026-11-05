"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ComposeInit } from "./compose";

/**
 * A work surface in the tab strip: either an opened email (reader) or an
 * in-progress message (compose). Compose tabs stay mounted while hidden so a
 * draft is never lost when you switch away — the whole point of タブ化.
 */
export type WorkTab =
  | { id: string; kind: "reader"; emailId: string; title: string }
  | { id: string; kind: "compose"; init: ComposeInit; title: string };

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Owns the open-tabs array and which one is active. Kept out of MailApp so the
 * (already large) component doesn't grow further. Pure UI state — no fetching.
 *
 * Reader tabs are keyed by email id (reopening the same mail re-focuses its
 * tab). Compose tabs are always fresh instances so several drafts can live at
 * once. `goBack` focuses the previously-active tab (ブラウザ戻る); going forward
 * is just clicking the tab, which always stays in the strip.
 */
export function useWorkTabs() {
  const [tabs, setTabs] = useState<WorkTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Previously-active ids, most-recent last. Used by 戻る only.
  const backStack = useRef<string[]>([]);

  // Committed mirrors so the callbacks below can stay synchronous and
  // dependency-free (they read current values without re-creating on change).
  // Updated in an effect — reads happen in event/popstate handlers (post-commit).
  const tabsRef = useRef<WorkTab[]>(tabs);
  const activeRef = useRef<string | null>(activeId);
  useEffect(() => {
    tabsRef.current = tabs;
    activeRef.current = activeId;
  });

  const activate = useCallback((id: string) => {
    if (!id || id === activeRef.current) return;
    if (activeRef.current) backStack.current.push(activeRef.current);
    setActiveId(id);
  }, []);

  /** Open (or re-focus) the reader tab for an email. */
  const openReader = useCallback(
    (emailId: string, title: string) => {
      const id = `r:${emailId}`;
      setTabs((ts) =>
        ts.some((t) => t.id === id)
          ? ts.map((t) =>
              t.id === id && t.kind === "reader" ? { ...t, title } : t,
            )
          : [...ts, { id, kind: "reader", emailId, title }],
      );
      activate(id);
      return id;
    },
    [activate],
  );

  /** Update a reader tab's label once the real subject has loaded. */
  const renameReader = useCallback((emailId: string, title: string) => {
    const id = `r:${emailId}`;
    setTabs((ts) =>
      ts.map((t) =>
        t.id === id && t.kind === "reader" && title ? { ...t, title } : t,
      ),
    );
  }, []);

  /** Open a brand-new compose tab (always its own instance). */
  const openCompose = useCallback(
    (init: ComposeInit, title: string) => {
      const id = nextId();
      setTabs((ts) => [...ts, { id, kind: "compose", init, title }]);
      activate(id);
      return id;
    },
    [activate],
  );

  const closeTab = useCallback((id: string) => {
    const cur = tabsRef.current;
    const idx = cur.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const next = cur.filter((t) => t.id !== id);
    setTabs(next);
    backStack.current = backStack.current.filter((x) => x !== id);
    if (activeRef.current === id) {
      // Focus the most-recent still-open tab, else the neighbour, else nothing.
      let fallback: string | null = null;
      while (backStack.current.length) {
        const cand = backStack.current.pop()!;
        if (next.some((t) => t.id === cand)) {
          fallback = cand;
          break;
        }
      }
      if (!fallback)
        fallback = next[Math.min(idx, next.length - 1)]?.id ?? null;
      setActiveId(fallback);
    }
  }, []);

  /** Deactivate every tab (list-only view) without closing any. */
  const clearActive = useCallback(() => {
    if (activeRef.current) backStack.current.push(activeRef.current);
    setActiveId(null);
  }, []);

  /** ブラウザ戻る: focus the previously-active still-open tab. */
  const goBack = useCallback((): boolean => {
    while (backStack.current.length) {
      const cand = backStack.current.pop()!;
      if (cand !== activeRef.current && tabsRef.current.some((t) => t.id === cand)) {
        setActiveId(cand);
        return true;
      }
    }
    return false;
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  return {
    tabs,
    activeId,
    activeTab,
    openReader,
    renameReader,
    openCompose,
    closeTab,
    activate,
    clearActive,
    goBack,
  };
}

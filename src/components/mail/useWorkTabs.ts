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
 * once.
 *
 * Navigation is browser-style (戻る/進む): `goBack`/`goForward` only move focus
 * between still-open tabs — they never close a tab (closing is the separate
 * ✕/⌘W action). A *new* navigation (clicking a tab, opening a reader/compose,
 * or going to the list view) truncates the forward history, exactly like a
 * browser. `backStack`/`fwdStack` hold ids, most-recent last.
 */
export function useWorkTabs() {
  const [tabs, setTabs] = useState<WorkTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Previously-active ids (戻る) and un-done ids (進む), most-recent last.
  const backStack = useRef<string[]>([]);
  const fwdStack = useRef<string[]>([]);
  // Reactive mirrors so the toolbar can enable/disable the 戻る/進む buttons.
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  // Committed mirrors so the callbacks below can stay synchronous and
  // dependency-free (they read current values without re-creating on change).
  // Updated in an effect — reads happen in event/popstate handlers (post-commit).
  const tabsRef = useRef<WorkTab[]>(tabs);
  const activeRef = useRef<string | null>(activeId);
  useEffect(() => {
    tabsRef.current = tabs;
    activeRef.current = activeId;
    // Recompute 戻る/進む availability from the (post-commit) tabs/active. Runs
    // after every render; setState bails when unchanged, so no render loop.
    const open = (id: string) => id !== activeId && tabs.some((t) => t.id === id);
    setCanBack(backStack.current.some(open));
    setCanForward(fwdStack.current.some(open));
    // Every stack mutation co-occurs with a tabs/activeId change, so these deps
    // cover all history changes (and keep the ref mirrors in sync each commit).
  }, [tabs, activeId]);

  /** Direct navigation (user clicked a tab / opened one): record history and
   *  truncate the forward stack, browser-style. */
  const activate = useCallback((id: string) => {
    if (!id || id === activeRef.current) return;
    if (activeRef.current) backStack.current.push(activeRef.current);
    fwdStack.current = [];
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
    fwdStack.current = fwdStack.current.filter((x) => x !== id);
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

  /** Deactivate every tab (list-only view) without closing any. A navigation,
   *  so it truncates the forward history too. */
  const clearActive = useCallback(() => {
    if (activeRef.current) backStack.current.push(activeRef.current);
    fwdStack.current = [];
    setActiveId(null);
  }, []);

  /** Close every tab at once (used by single-tab mode before opening a new one). */
  const closeAll = useCallback(() => {
    backStack.current = [];
    fwdStack.current = [];
    setTabs([]);
    setActiveId(null);
  }, []);

  /** ブラウザ戻る: focus the previously-active still-open tab. Pushes the tab we
   *  leave onto the forward stack so 進む can return. Never closes a tab. */
  const goBack = useCallback((): boolean => {
    while (backStack.current.length) {
      const cand = backStack.current.pop()!;
      if (cand !== activeRef.current && tabsRef.current.some((t) => t.id === cand)) {
        if (activeRef.current) fwdStack.current.push(activeRef.current);
        setActiveId(cand);
        return true;
      }
    }
    return false;
  }, []);

  /** ブラウザ進む: redo a 戻る. Mirror of goBack via the forward stack. */
  const goForward = useCallback((): boolean => {
    while (fwdStack.current.length) {
      const cand = fwdStack.current.pop()!;
      if (cand !== activeRef.current && tabsRef.current.some((t) => t.id === cand)) {
        if (activeRef.current) backStack.current.push(activeRef.current);
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
    closeAll,
    activate,
    clearActive,
    goBack,
    goForward,
    canBack,
    canForward,
  };
}

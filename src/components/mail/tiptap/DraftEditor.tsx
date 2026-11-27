"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import type { JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { Segment } from "@/lib/diff";
import { SuggestionNode } from "./suggestionNode";
import { handleLineNavKeyDown, handleTripleClickLine } from "./lineNav";
import { createImeEnterGuard, type ImeEnterGuard } from "./imeEnter";
import {
  countSuggestions,
  docFromText,
  inlineFromText,
  reviewDoc,
  serializeDoc,
} from "./textDoc";

export interface DraftEditorHandle {
  getText: () => string;
  loadReview: (segments: Segment[]) => void;
  setText: (text: string) => void;
  resolveAll: (which: "before" | "after") => void;
  /** Sync the parent (body/pending) immediately, cancelling the debounce. */
  flush: () => void;
}

// タイピング中の親同期は debounce。この間隔でまとめて反映する。
const EMIT_DEBOUNCE_MS = 150;

export interface DraftEditorChange {
  text: string;
  pending: number;
}

// Single paragraph only; Enter inserts a line break instead of splitting.
const SingleDocument = Document.extend({ content: "paragraph" });
const LineBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.setHardBreak() };
  },
});

export const DraftEditor = forwardRef<
  DraftEditorHandle,
  {
    onChange: (c: DraftEditorChange) => void;
    onSelectionChange?: (text: string) => void;
    placeholder?: string;
    /** Controlled initial/replacement text; applied once the editor is ready. */
    loadText?: string | null;
  }
>(function DraftEditor({ onChange, onSelectionChange, placeholder, loadText }, ref) {
  const appliedTextRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelRef = useRef(onSelectionChange);
  onSelRef.current = onSelectionChange;
  // IME-confirm Enter must only CONFIRM the 変換, never insert a line break
  // (WKWebView fires compositionend before the confirming keydown — see imeEnter).
  const imeRef = useRef<ImeEnterGuard | null>(null);
  if (imeRef.current === null) imeRef.current = createImeEnterGuard();
  const ime = imeRef.current;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      SingleDocument,
      Paragraph,
      Text,
      LineBreak,
      History,
      SuggestionNode,
      Placeholder.configure({
        placeholder: placeholder ?? "ここに本文を入力…",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          // leading-6 (24px): 空行に立つカーソルは行の高さいっぱいに描かれる
          // ため、leading-7(28px) だと宛名の下の空行でカーソルが文字より明らかに
          // 太く見えた（WKWebView）。本文の読みやすさを保てる範囲で詰めて軽減。
          "min-h-full whitespace-pre-wrap text-[15px] leading-6 outline-none",
        // macOS WKWebView の既定テキスト置換（自動修正＝語尾スペース挿入・
        // スマート引用符・自動大文字化）を無効化。メール本文で「勝手にスペース/
        // 大文字が入る」のを防ぐ。RecipientFields / AccountImapForm と同方針。
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        autocomplete: "off",
      },
      // IME 変換を確定する Enter（WKWebView では isComposing=false で届く）は
      // keymap の setHardBreak を走らせず飲み込む。続けて macOS の行頭/行末移動。
      handleKeyDown: (view, event) => {
        if (ime.isImeConfirmEnter(event)) return true;
        return handleLineNavKeyDown(view, event);
      },
      // 変換の開始/終了を自前で追跡（確定Enter判定に使う）。
      handleDOMEvents: {
        compositionstart: () => {
          ime.onCompositionStart();
          return false;
        },
        compositionend: () => {
          ime.onCompositionEnd();
          return false;
        },
        // フォーカスを外したら保留中の同期を即確定（送信ボタンの活性やレビュー
        // 判定を最新に。送信本文自体は editor ref を直読みするので別途保証）。
        blur: () => {
          flushEmit();
          return false;
        },
      },
      // トリプルクリック=その行を選択（単一段落なので既定は全文選択になる）。
      handleTripleClick: handleTripleClickLine,
      // The doc is a single paragraph, so default paste (which builds multiple
      // block nodes) is rejected and nothing appears. Flatten ANY pasted slice
      // — whether ProseMirror parsed it from text/plain, text/html, or RTF
      // (clipboard managers like Maccy/Clippy often restore HTML/RTF without a
      // clean text/plain) — into this paragraph: block breaks & hardBreaks → \n.
      transformPasted(slice, view) {
        const text = slice.content.textBetween(0, slice.content.size, "\n", "\n");
        const { schema } = view.state;
        const nodes: PMNode[] = [];
        text.split(/\r?\n/).forEach((line, i) => {
          if (i > 0) nodes.push(schema.nodes.hardBreak.create());
          if (line) nodes.push(schema.text(line));
        });
        return new Slice(Fragment.fromArray(nodes), 0, 0);
      },
    },
    onUpdate({ editor }) {
      // IME 変換中は親の再描画を走らせない（WKWebView で変換中の再描画が重く、
      // カーソル位置を乱すため。確定後の transaction で本文stateは同期される）。
      // RichEditor と同方針。
      if (editor.view.composing) return;
      // キー入力ごとに getJSON→直列化→countSuggestions→親の再描画まで全部やると、
      // 長文（引用込み）＋WKWebView で入力がもたつく。短いアイドルでまとめて反映し、
      // タイピング中は contenteditable の編集そのものを妨げない。送信など本文を
      // 確定読みする箇所は editor ref を直読みするので、debounce の遅れに依存しない。
      scheduleEmit();
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      onSelRef.current?.(from === to ? "" : editor.state.doc.textBetween(from, to, "\n"));
    },
  });

  // 親同期（body/pending）。即時版と debounce 版。構造変更系は即時、タイピングは
  // debounce。emitTimerRef で保留中タイマを管理する。
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function emitNow() {
    if (emitTimerRef.current) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    }
    if (!editor) return;
    const json = editor.getJSON();
    onChangeRef.current({ text: serializeDoc(json), pending: countSuggestions(json) });
  }
  function scheduleEmit() {
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      emitTimerRef.current = null;
      emitNow();
    }, EMIT_DEBOUNCE_MS);
  }
  function flushEmit() {
    if (emitTimerRef.current) emitNow();
  }

  useImperativeHandle(ref, () => ({
    getText: () => (editor ? serializeDoc(editor.getJSON()) : ""),
    flush: flushEmit,
    setText: (text: string) => {
      if (!editor) return;
      editor.commands.setContent(docFromText(text));
      emitNow();
    },
    loadReview: (segments: Segment[]) => {
      if (!editor) return;
      editor.commands.setContent(reviewDoc(segments));
      emitNow();
    },
    resolveAll: (which: "before" | "after") => {
      if (!editor) return;
      const json = editor.getJSON() as JSONContent;
      const para = json.content?.[0] as JSONContent | undefined;
      const items = (para?.content ?? []) as JSONContent[];
      if (items.length === 0) return;
      const content = items.flatMap((n) =>
        n.type === "suggestion"
          ? inlineFromText((n.attrs?.[which] as string) ?? "")
          : [n],
      );
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", content }],
      });
      emitNow();
    },
  }));

  // Apply controlled text once the editor exists / when it changes.
  useEffect(() => {
    if (!editor || loadText == null) return;
    if (appliedTextRef.current === loadText) return;
    appliedTextRef.current = loadText;
    editor.commands.setContent(docFromText(loadText));
    emitNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, loadText]);

  useEffect(() => {
    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
      editor?.destroy();
    };
  }, [editor]);

  return <EditorContent editor={editor} className="h-full" />;
});

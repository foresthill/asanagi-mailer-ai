"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Placeholder from "@tiptap/extension-placeholder";
import type { JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { Segment } from "@/lib/diff";
import { SuggestionNode } from "./suggestionNode";
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
}

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

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      SingleDocument,
      Paragraph,
      Text,
      LineBreak,
      SuggestionNode,
      Placeholder.configure({ placeholder: placeholder ?? "本文" }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "min-h-full whitespace-pre-wrap text-[15px] leading-7 outline-none",
      },
      // The doc is a single paragraph, so the default paste (which builds
      // multiple block nodes) is rejected and nothing appears. Flatten the
      // clipboard's plain text into this paragraph: newlines → hardBreaks.
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false; // non-text (e.g. image) → default handling
        event.preventDefault();
        const { schema } = view.state;
        const nodes: PMNode[] = [];
        text.split(/\r?\n/).forEach((line, i) => {
          if (i > 0) nodes.push(schema.nodes.hardBreak.create());
          if (line) nodes.push(schema.text(line));
        });
        const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
    onUpdate({ editor }) {
      const json = editor.getJSON();
      onChangeRef.current({ text: serializeDoc(json), pending: countSuggestions(json) });
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      onSelRef.current?.(from === to ? "" : editor.state.doc.textBetween(from, to, "\n"));
    },
  });

  function emit() {
    if (!editor) return;
    const json = editor.getJSON();
    onChangeRef.current({ text: serializeDoc(json), pending: countSuggestions(json) });
  }

  useImperativeHandle(ref, () => ({
    getText: () => (editor ? serializeDoc(editor.getJSON()) : ""),
    setText: (text: string) => {
      if (!editor) return;
      editor.commands.setContent(docFromText(text));
      emit();
    },
    loadReview: (segments: Segment[]) => {
      if (!editor) return;
      editor.commands.setContent(reviewDoc(segments));
      emit();
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
      emit();
    },
  }));

  // Apply controlled text once the editor exists / when it changes.
  useEffect(() => {
    if (!editor || loadText == null) return;
    if (appliedTextRef.current === loadText) return;
    appliedTextRef.current = loadText;
    editor.commands.setContent(docFromText(loadText));
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, loadText]);

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  return <EditorContent editor={editor} className="h-full" />;
});

"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link2,
} from "lucide-react";

export interface RichEditorHandle {
  getHtml: () => string;
  getText: () => string;
  /** Replace the whole document (used when applying an AI whole-message edit). */
  setHtml: (html: string) => void;
}

export interface RichEditorChange {
  html: string;
  text: string;
}

/**
 * Image files from a paste/drop DataTransfer. Pasted clipboard images (e.g.
 * screenshots) usually arrive via `items`, not `files`, so check both.
 */
function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const fromFiles = Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (fromFiles.length) return fromFiles;
  return Array.from(dt.items ?? [])
    .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter((f): f is File => f != null);
}

/** One toolbar toggle button. */
function TBtn({
  on,
  active,
  title,
  children,
}: {
  on: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Keep editor focus/selection when clicking the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      title={title}
      className={`grid size-7 place-items-center rounded-md transition-colors ${
        active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Rich HTML editor for compose "リッチ編集" mode. Formatting toolbar (bold,
 * italic, underline, lists, link) + inline images (paste/drop, held as base64
 * data URLs; the composer converts them to cid at send time). AI 添削 is not
 * wired here — that lives in the plain editor.
 */
export const RichEditor = forwardRef<
  RichEditorHandle,
  {
    onChange: (c: RichEditorChange) => void;
    /** Controlled initial HTML, applied once the editor is ready. */
    loadHtml?: string | null;
    placeholder?: string;
  }
>(function RichEditor({ onChange, loadHtml, placeholder }, ref) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const editorRef = useRef<Editor | null>(null);
  const appliedRef = useRef<string | null>(null);
  // Bump on every transaction so toolbar active-states stay in sync.
  const [, force] = useState(0);

  const insertImageFiles = (files: File[]) => {
    files
      .filter((f) => f.type.startsWith("image/"))
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () =>
          editorRef.current?.chain().focus().setImage({ src: String(reader.result) }).run();
        reader.readAsDataURL(file);
      });
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      History,
      Bold,
      Italic,
      Underline,
      BulletList,
      OrderedList,
      ListItem,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: placeholder ?? "本文（画像は貼り付け・ドロップで挿入）" }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "min-h-full text-[15px] leading-7 outline-none [&_img]:my-1.5 [&_img]:max-w-full [&_img]:rounded-md [&_p]:min-h-[1.2em] [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-accent [&_a]:underline",
      },
      handlePaste(_view, event) {
        // Only intercept image pastes; text/HTML falls through to ProseMirror.
        const imgs = imageFilesFrom(event.clipboardData);
        if (!imgs.length) return false;
        event.preventDefault();
        insertImageFiles(imgs);
        return true;
      },
      handleDrop(_view, event) {
        const imgs = imageFilesFrom((event as DragEvent).dataTransfer);
        if (!imgs.length) return false;
        event.preventDefault();
        insertImageFiles(imgs);
        return true;
      },
    },
    onUpdate({ editor }) {
      onChangeRef.current({ html: editor.getHTML(), text: editor.getText() });
    },
    onSelectionUpdate() {
      force((n) => n + 1);
    },
    onTransaction() {
      force((n) => n + 1);
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useImperativeHandle(ref, () => ({
    getHtml: () => editor?.getHTML() ?? "",
    getText: () => editor?.getText() ?? "",
    setHtml: (html: string) => {
      if (!editor) return;
      editor.commands.setContent(html);
      onChangeRef.current({ html: editor.getHTML(), text: editor.getText() });
    },
  }));

  useEffect(() => {
    if (!editor || loadHtml == null) return;
    if (appliedRef.current === loadHtml) return;
    appliedRef.current = loadHtml;
    editor.commands.setContent(loadHtml);
    onChangeRef.current({ html: editor.getHTML(), text: editor.getText() });
  }, [editor, loadHtml]);

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("リンクURL（空で解除）", prev ?? "https://");
    if (url === null) return; // cancelled
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url.trim() === "") chain.unsetLink().run();
    else chain.setLink({ href: url.trim() }).run();
  };

  return (
    <>
      <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-0.5 border-b border-border bg-bg/95 pb-1.5 backdrop-blur">
        <TBtn on={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold")} title="太字">
          <BoldIcon className="size-4" />
        </TBtn>
        <TBtn on={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic")} title="斜体">
          <ItalicIcon className="size-4" />
        </TBtn>
        <TBtn on={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive("underline")} title="下線">
          <UnderlineIcon className="size-4" />
        </TBtn>
        <div className="mx-1 h-5 w-px bg-border" />
        <TBtn on={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList")} title="箇条書き">
          <List className="size-4" />
        </TBtn>
        <TBtn on={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList")} title="番号付きリスト">
          <ListOrdered className="size-4" />
        </TBtn>
        <div className="mx-1 h-5 w-px bg-border" />
        <TBtn on={setLink} active={editor?.isActive("link")} title="リンク">
          <Link2 className="size-4" />
        </TBtn>
      </div>
      <EditorContent editor={editor} className="h-full" />
    </>
  );
});

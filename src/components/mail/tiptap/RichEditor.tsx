"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";

export interface RichEditorHandle {
  getHtml: () => string;
  getText: () => string;
}

export interface RichEditorChange {
  html: string;
  text: string;
}

/**
 * Rich HTML editor for compose "リッチ編集" mode. Supports pasting/dropping
 * images, which are held inline as base64 data URLs; the composer converts
 * those to cid references (multipart/related) at send time. AI 添削 (inline
 * suggestions) is intentionally NOT wired here — that lives in the plain editor.
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
  onChangeRef.current = onChange;
  const editorRef = useRef<Editor | null>(null);
  const appliedRef = useRef<string | null>(null);

  // Read image files and insert them inline as base64 (cid conversion is done
  // at send time). Uses the ref so the editorProps closure never goes stale.
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
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: placeholder ?? "本文（画像は貼り付け・ドロップで挿入）" }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "min-h-full text-[15px] leading-7 outline-none [&_img]:my-1.5 [&_img]:max-w-full [&_img]:rounded-md [&_p]:min-h-[1.2em]",
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.some((f) => f.type.startsWith("image/"))) return false;
        event.preventDefault();
        insertImageFiles(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.some((f) => f.type.startsWith("image/"))) return false;
        event.preventDefault();
        insertImageFiles(files);
        return true;
      },
    },
    onUpdate({ editor }) {
      onChangeRef.current({ html: editor.getHTML(), text: editor.getText() });
    },
  });
  editorRef.current = editor;

  useImperativeHandle(ref, () => ({
    getHtml: () => editor?.getHTML() ?? "",
    getText: () => editor?.getText() ?? "",
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

  return <EditorContent editor={editor} className="h-full" />;
});

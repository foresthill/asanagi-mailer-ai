"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Check, X } from "lucide-react";

/**
 * Inline atom node representing one pending AI edit (a "hunk").
 * Holds the original (`before`) and proposed (`after`) text. The user accepts
 * (replace with `after`) or rejects (replace with `before`) it in place.
 */
export const SuggestionNode = Node.create({
  name: "suggestion",
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      before: { default: "" },
      after: { default: "" },
      sid: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-suggestion]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-suggestion": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SuggestionView);
  },
});

function SuggestionView({ node, editor, getPos }: NodeViewProps) {
  const before = (node.attrs.before as string) ?? "";
  const after = (node.attrs.after as string) ?? "";

  function replaceWithText(text: string) {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    const { schema } = editor;
    const nodes: PMNode[] = [];
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) nodes.push(schema.nodes.hardBreak.create());
      if (line.length > 0) nodes.push(schema.text(line));
    });
    const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, nodes);
    editor.view.dispatch(tr);
    editor.commands.focus();
  }

  return (
    <NodeViewWrapper
      as="span"
      className="mx-0.5 inline rounded-md bg-accent-soft/60 px-1 align-baseline ring-1 ring-accent/30"
      contentEditable={false}
    >
      {before && <span className="bg-high-soft text-high line-through">{before}</span>}
      {after && (
        <span className="whitespace-pre-wrap bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          {after}
        </span>
      )}
      <span className="ml-1 inline-flex translate-y-[2px] gap-0.5">
        <button
          type="button"
          onClick={() => replaceWithText(after)}
          title="採用"
          className="grid size-5 place-items-center rounded bg-accent text-accent-fg hover:opacity-90"
        >
          <Check className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => replaceWithText(before)}
          title="却下"
          className="grid size-5 place-items-center rounded border border-border bg-surface text-fg-muted hover:text-high"
        >
          <X className="size-3" />
        </button>
      </span>
    </NodeViewWrapper>
  );
}

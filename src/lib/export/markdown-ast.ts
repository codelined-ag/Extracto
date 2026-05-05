import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Root } from "mdast";

export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

export function nodeToPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as { type?: string; value?: unknown; children?: unknown[] };
  if (typeof obj.value === "string") return obj.value;
  if (!Array.isArray(obj.children)) return "";
  return obj.children.map(nodeToPlainText).join("");
}

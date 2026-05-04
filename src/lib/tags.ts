export const TAG_COLORS = [
  "slate",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export const isTagColor = (value: unknown): value is TagColor =>
  typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value);

export const normalizeTagName = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 32);
};

export const normalizeTagColor = (raw: unknown): TagColor =>
  isTagColor(raw) ? raw : "slate";

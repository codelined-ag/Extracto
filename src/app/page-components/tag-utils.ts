import type { TagColor } from "@/app/page-components/types";

export const TAG_COLOR_OPTIONS: TagColor[] = [
  "slate",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
];

export const tagChipClass = (color: TagColor): string => {
  switch (color) {
    case "blue":
      return "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200";
    case "green":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200";
    case "yellow":
      return "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/60 dark:text-yellow-200";
    case "orange":
      return "bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200";
    case "red":
      return "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200";
    case "pink":
      return "bg-pink-100 text-pink-900 dark:bg-pink-950/60 dark:text-pink-200";
    case "purple":
      return "bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-200";
    case "slate":
    default:
      return "bg-muted text-foreground/80";
  }
};

export const tagSwatchClass = (color: TagColor): string => {
  switch (color) {
    case "blue":
      return "bg-blue-500";
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-yellow-500";
    case "orange":
      return "bg-orange-500";
    case "red":
      return "bg-red-500";
    case "pink":
      return "bg-pink-500";
    case "purple":
      return "bg-purple-500";
    case "slate":
    default:
      return "bg-slate-400";
  }
};

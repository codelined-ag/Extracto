import type { UiLanguage } from "@/app/page-components/types";

export const UI_LANGUAGES: UiLanguage[] = ["it", "en", "fr", "es", "de"];

export const UI_LANGUAGE_FLAGS: Record<UiLanguage, string> = {
  it: "🇮🇹",
  en: "🇬🇧",
  fr: "🇫🇷",
  es: "🇪🇸",
  de: "🇩🇪",
};

export const UI_LANGUAGE_LABELS: Record<UiLanguage, string> = {
  it: "Italiano",
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
};

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (UI_LANGUAGES as string[]).includes(value);
}

// Interface translation. Russian source strings are the keys (gettext style):
// t("Подключено") returns the string in the current locale, falling back to
// the Russian original. Dictionaries live in en.ts and zh.ts; i18n.test.ts
// fails when a string used in the code or the HTML has no translation.

import { en } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "ru" | "zh";
export type LanguageSetting = "auto" | Locale;
export type Params = Record<string, string | number>;

export const LOCALES: readonly Locale[] = ["en", "ru", "zh"];

const DICTIONARIES: Record<Exclude<Locale, "ru">, Record<string, string>> = { en, zh };

// Tests and pages that never call setLocale keep the original Russian text.
let current: Locale = "ru";

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
  }
}

/** Picks a locale from BCP 47 tags such as navigator.languages. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (primary === "zh") return "zh";
    if (primary === "ru" || primary === "be" || primary === "kk") return "ru";
    if (primary === "en") return "en";
  }
  return "en";
}

export function resolveLanguage(setting: string | undefined, languages: readonly string[]): Locale {
  return LOCALES.includes(setting as Locale) ? (setting as Locale) : detectLocale(languages);
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

interface Template {
  pattern: RegExp;
  names: string[];
  key: string;
}

const templateCache = new Map<Locale, Template[]>();

/** Dictionary keys with `{name}` slots, compiled to match already-filled strings. */
function templates(locale: Exclude<Locale, "ru">): Template[] {
  let list = templateCache.get(locale);
  if (list) return list;
  list = Object.keys(DICTIONARIES[locale])
    .filter((key) => /\{\w+\}/.test(key))
    .map((key) => {
      const names: string[] = [];
      const source = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const slot = /^\{(\w+)\}$/.exec(part);
          if (slot) {
            names.push(slot[1]);
            return "(.+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      return { pattern: new RegExp(`^${source}$`, "s"), names, key };
    });
  templateCache.set(locale, list);
  return list;
}

/**
 * Messages that arrive already filled in (errors from Rust or a worker, such
 * as "Сочетание занято другой программой: Ctrl+T") are matched against the
 * templated keys; filled values are translated too when they are known strings.
 */
function translateFilled(locale: Exclude<Locale, "ru">, text: string): string | undefined {
  for (const template of templates(locale)) {
    const match = template.pattern.exec(text);
    if (!match) continue;
    const params: Params = {};
    template.names.forEach((name, index) => {
      const value = match[index + 1];
      params[name] = DICTIONARIES[locale][value] ?? value;
    });
    return interpolate(DICTIONARIES[locale][template.key], params);
  }
  return undefined;
}

/** Translates a Russian source string; `{name}` placeholders are filled from params. */
export function t(source: string, params?: Params): string {
  if (current === "ru") return interpolate(source, params);
  const dictionary = DICTIONARIES[current];
  const translated = dictionary[source] ?? (params ? undefined : translateFilled(current, source)) ?? source;
  return interpolate(translated, params);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Translates static markup: `data-i18n` elements get their text replaced and
 * `data-i18n-attr="placeholder,aria-label"` lists translated attributes. The
 * Russian original is remembered on the element, so switching back and forth works.
 */
export function applyTranslations(root: ParentNode = document): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n]"))) {
    const source = element.dataset.i18nSource ?? normalize(element.textContent ?? "");
    element.dataset.i18nSource = source;
    element.textContent = t(source);
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n-attr]"))) {
    for (const attr of (element.dataset.i18nAttr ?? "").split(",").map((name) => name.trim()).filter(Boolean)) {
      const key = `i18nSrc${attr.replace(/(^|-)(\w)/g, (_, _dash: string, char: string) => char.toUpperCase())}`;
      const source = element.dataset[key] ?? normalize(element.getAttribute(attr) ?? "");
      element.dataset[key] = source;
      element.setAttribute(attr, t(source));
    }
  }
}

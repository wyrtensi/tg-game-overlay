/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from "vitest";
import { en } from "./en";
import { detectLocale, resolveLanguage, setLocale, t } from "./index";
import { zh } from "./zh";

// Raw sources, read through Vite so the test needs no Node typings.
const TS_SOURCES = import.meta.glob(["/src/**/*.ts", "!/src/**/*.test.ts", "!/src/i18n/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const RS_SOURCES = import.meta.glob(["/src-tauri/src/*.rs", "!/src-tauri/src/*_test.rs", "!/src-tauri/src/i18n.rs"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const STYLES = import.meta.glob(["/src/**/*.css"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PAGES = import.meta.glob(["/index.html", "/overlay.html"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const CYRILLIC = /[А-Яа-яЁё]/;

// Strings that never reach a person: dev-only fallbacks, hidden worker
// windows, the plain-browser demo, and backend text that Rust translates itself.
const NOT_SHOWN = new Set([
  "Демо-режим не поддерживает команду {}",
  "Тестовая игра",
  "Другая тестовая игра",
  "Tauri недоступен ({})",
  "WebCrypto недоступен",
  "воркер запущен",
  "ошибка запуска: {}",
  "запуск...",
  "Найдено наборов: {}",
  "Telegram overlay - пауза",
  "Настройки",
  "Пауза",
  "Выход",
  "Стас",
  "Аня",
  "зайдёшь на катку?",
  "смотри что нашёл в патче",
  "не забудь про созвон в 19:00",
  "го в 21, я освобожусь",
  "сюда же прилетит картинка",
]);

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
/** Placeholder names do not matter for matching: `{hotkey}` and `${expr}` both become `{}`. */
const shape = (text: string) => normalize(text).replace(/\$\{[^}]*\}|\{[^}]*\}/g, "{}");

function sourceStrings(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (text: string, where: string) => {
    const value = normalize(text);
    if (value && CYRILLIC.test(value) && !found.has(value)) found.set(value, where);
  };

  for (const [path, raw] of Object.entries(TS_SOURCES)) {
    if (/demo-|node-globals-shim|process-shim/.test(path)) continue;
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
    for (const match of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      add(match[1] ?? match[2], path);
    }
  }

  for (const [path, raw] of Object.entries(RS_SOURCES)) {
    const text = raw.replace(/\/\/[^\n]*/g, "").split(/#\[cfg\(test\)\]\s*mod tests/)[0];
    for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"/g)) add(match[1], path);
  }

  for (const [page, html] of Object.entries(PAGES)) {
    for (const match of html.matchAll(/<[^>]*\sdata-i18n(?:\s[^>]*)?>([^<]*)</g)) add(match[1], page);
    for (const match of html.matchAll(/<[^>]*data-i18n-attr="([^"]*)"[^>]*>/g)) {
      for (const attr of match[1].split(",")) {
        const value = new RegExp(`\\s${attr.trim()}="([^"]*)"`).exec(match[0]);
        if (value) add(value[1], page);
      }
    }
    // Russian text left outside data-i18n markup would never be translated.
    const stripped = html
      .replace(/<[^>]*\sdata-i18n(?:\s[^>]*)?>[^<]*</g, "<")
      .replace(/\s(placeholder|aria-label|alt|title)="[^"]*"/g, "")
      .replace(/<option value="ru">Русский<\/option>/, "");
    expect(stripped.match(/>[^<]*[А-Яа-яЁё][^<]*</g) ?? [], `untranslated text in ${page}`).toEqual([]);
  }
  return found;
}

describe("dictionaries", () => {
  it("leave no Russian text in stylesheets, where it cannot be translated", () => {
    expect(Object.keys(STYLES).length).toBeGreaterThan(0);
    for (const [path, css] of Object.entries(STYLES)) {
      expect(css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[А-Яа-яЁё]+/g) ?? [], path).toEqual([]);
    }
  });

  it("have the same keys in every language", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("keep the placeholders of each key", () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(zh)]) {
      const names = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(names(value), key).toEqual(names(key));
    }
  });

  it("translate every Russian string shown in the interface", () => {
    expect(Object.keys(TS_SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(RS_SOURCES).length).toBeGreaterThan(5);
    expect(Object.keys(PAGES)).toHaveLength(2);
    const known = new Set(Object.keys(en).map(shape));
    const missing = [...sourceStrings()]
      .filter(([text]) => !NOT_SHOWN.has(shape(text)) && !known.has(shape(text)))
      .map(([text, where]) => `${where}: ${text}`);
    expect(missing).toEqual([]);
  });
});

describe("t", () => {
  afterEach(() => setLocale("ru"));

  it("returns the Russian source by default", () => {
    expect(t("Подключено")).toBe("Подключено");
    expect(t("Игр: {count}", { count: 2 })).toBe("Игр: 2");
  });

  it("translates and fills placeholders", () => {
    setLocale("en");
    expect(t("Игр: {count}", { count: 2 })).toBe("Games: 2");
    setLocale("zh");
    expect(t("Подключено")).toBe("已连接");
  });

  it("translates messages that arrive already filled in", () => {
    setLocale("en");
    expect(t("Сочетание занято другой программой: Ctrl+T")).toBe("The combination is taken by another program: Ctrl+T");
    expect(t("Не удалось загрузить чаты: Telegram не ответил")).toBe("Could not load chats: Telegram did not respond");
  });

  it("leaves unknown text, such as what people write, untouched", () => {
    setLocale("en");
    expect(t("привет, го играть")).toBe("привет, го играть");
  });
});

describe("language detection", () => {
  it("maps system languages", () => {
    expect(detectLocale(["zh-CN"])).toBe("zh");
    expect(detectLocale(["zh-TW", "en"])).toBe("zh");
    expect(detectLocale(["ru-RU"])).toBe("ru");
    expect(detectLocale(["de-DE", "en-US"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("prefers an explicit setting", () => {
    expect(resolveLanguage("zh", ["ru-RU"])).toBe("zh");
    expect(resolveLanguage("auto", ["ru-RU"])).toBe("ru");
    expect(resolveLanguage(undefined, ["en-GB"])).toBe("en");
  });
});

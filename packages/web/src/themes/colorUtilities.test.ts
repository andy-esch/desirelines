import { describe, it, expect } from "vitest";
import { TAILWIND_CSS, THEME_FILES } from "../test/themeCss";

/**
 * Components color through theme tokens only. Tailwind's built-in palette utilities
 * (`text-white`, `bg-black/50`, `border-slate-500`, …) bypass the theme blocks entirely,
 * so they look right in one theme and wrong in the next; the hue-named `slate-*` tokens
 * and the two ink tokens they replaced are retired. Scans source text, so it catches
 * class strings inside `cn()`, template literals and props alike.
 */
const sources = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const PALETTE =
  "white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}";
const UTILITY_PREFIX =
  "text|bg|border(?:-[trblxy])?|ring|ring-offset|outline|divide|fill|stroke|from|via|to|shadow|placeholder|decoration|accent|caret";
const BUILT_IN_COLOR = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:|\\[[^\\]]*\\]:)*(?:${UTILITY_PREFIX})-(?:${PALETTE})(?:/[\\w.[\\]]+)?(?![\\w-])`,
  "g"
);
const RETIRED_TOKENS =
  /--color-(?:slate\b|on-neon\b|sport-on\b)|(?<![\w-])[\w-]+-slate-(?:dark|DEFAULT|light|lighter)\b|(?<![\w-])(?:text|bg)-(?:sport-on|on-neon)\b/g;

function findAll(pattern: RegExp) {
  return Object.entries(sources).flatMap(([file, text]) =>
    text
      .split("\n")
      .flatMap((line, i) =>
        [...line.matchAll(pattern)].map((m) => `${file.replace(/^\.\.\//, "")}:${i + 1} ${m[0]}`)
      )
  );
}

describe("theme-token-only colors", () => {
  it("scans the app sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("uses no built-in Tailwind palette color utilities", () => {
    expect(findAll(BUILT_IN_COLOR)).toEqual([]);
  });

  it("references no retired color tokens", () => {
    expect(findAll(RETIRED_TOKENS)).toEqual([]);
    for (const css of [TAILWIND_CSS, ...THEME_FILES.values()]) {
      expect(css.match(/--color-(?:slate|on-neon|sport-on)\b[\w-]*/g) ?? []).toEqual([]);
    }
  });

  it("would catch the utilities it guards against", () => {
    // Guard the guard: a regex that silently matches nothing passes every scan above.
    for (const sample of [
      "text-white",
      "hover:bg-white/[0.08]",
      "data-[highlighted]:text-white",
      "shadow-black/40",
      "border-slate-500",
    ]) {
      expect(sample.match(BUILT_IN_COLOR), sample).not.toBeNull();
    }
    for (const sample of [
      "text-muted-text",
      "bg-scrim/50",
      "btn-outline-slate",
      "translate-x-full",
    ]) {
      expect(sample.match(BUILT_IN_COLOR), sample).toBeNull();
    }
  });
});

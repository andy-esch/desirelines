import { describe, it, expect } from "vitest";

/**
 * The user's config is read and saved through the config store (`UserConfigProvider` and
 * the section hooks over it), and the theme's device keys through the theme store
 * (`ThemeContext`). A module that went around them would bring back the bugs the stores
 * ended: a second listener, a cache entry of its own going stale, or demo and account data
 * mixing. This fails when a module outside the stores:
 *
 * - constructs `UserConfigService`, the account's Firestore reads and writes;
 * - builds a `"userConfig"` query key, the store's cache entry;
 * - touches a demo- or account-namespace localStorage key, or the demo's storage module.
 */

/** The config store's modules, each with its part. */
const CONFIG_STORE: Readonly<Record<string, string>> = {
  "services/config/configAdapter.ts": "the store's cache keys",
  "services/config/firestoreAdapter.ts": "the account's side, over UserConfigService",
  "services/config/demoAdapter.ts": "the demo's side, over the demo's storage",
  "services/userConfigService.ts": "the account's Firestore reads and writes",
  "services/demoStorage.ts": "the demo's keys, and their reads and writes",
};

/** The theme store's modules: the theme's own device keys, which the config store never reads. */
const THEME_STORE: Readonly<Record<string, string>> = {
  "themes/registry.ts": "names the keys (demo.theme, account.theme, account.signedIn)",
  "themes/bootScript.ts": "applies the stored theme before React mounts",
  "contexts/ThemeContext.tsx": "reads and writes the keys while the app runs",
};

/** Modules outside the stores that touch one of their names, each with why that's safe. */
const ALLOWED: Readonly<Record<string, string>> = {
  "index.tsx":
    "moves the demo's keys from before they had a namespace, before the app mounts; it reads no section",
};

const sources = import.meta.glob<string>(
  ["../../**/*.{ts,tsx}", "!../../**/*.test.{ts,tsx}", "!../../test/**", "!../../**/*.d.ts"],
  { query: "?raw", import: "default", eager: true }
);
/** Paths from `src/`, with comments dropped: a comment may name what it warns against. */
const files = Object.entries(sources).map(
  ([path, text]) =>
    [
      new URL(path, "file:///src/services/config/").pathname.replace(/^\/src\//, ""),
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    ] as const
);

const RULES = {
  "constructs UserConfigService": /\bnew\s+UserConfigService\b/,
  'builds a "userConfig" query key': /["'`]userConfig["'`]/,
  "touches a demo- or account-namespace localStorage key":
    /["'`](?:demo|account)\.\w|\b(?:DEMO_STORAGE_PREFIX|THEME_STORAGE_KEYS|SIGNED_IN_HINT_KEY)\b|services\/demoStorage["']|\.\/demoStorage["']/,
} as const;

const inside = new Set([
  ...Object.keys(CONFIG_STORE),
  ...Object.keys(THEME_STORE),
  ...Object.keys(ALLOWED),
]);
const breaking = (rule: RegExp) =>
  files.filter(([path, text]) => !inside.has(path) && rule.test(text)).map(([path]) => path);

describe("the config and theme stores' boundary", () => {
  it("scans the app's modules", () => {
    const paths = files.map(([path]) => path);
    expect(paths.length).toBeGreaterThan(100);
    expect(paths).toContain("hooks/useGoals.ts");
    expect(paths).toContain("services/config/firestoreAdapter.ts");
    expect(paths).toContain("index.tsx");
  });

  it.each(Object.entries(RULES))("nothing outside the stores %s", (_, rule) => {
    expect(breaking(rule)).toEqual([]);
  });

  it("lists the stores' modules as they are", () => {
    const paths = files.map(([path]) => path);
    for (const path of [...Object.keys(CONFIG_STORE), ...Object.keys(THEME_STORE)]) {
      expect(paths).toContain(path);
    }
  });

  it("allows only modules that still touch one of the stores' names", () => {
    const touching = files
      .filter(([, text]) => Object.values(RULES).some((rule) => rule.test(text)))
      .map(([path]) => path);
    for (const path of Object.keys(ALLOWED)) expect(touching).toContain(path);
  });
});

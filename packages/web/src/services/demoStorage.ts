/**
 * Demo mode's storage. What a signed-out visitor sets (goals, settings, annotations) lives in
 * localStorage under `demo.`, and only demo code reads or writes those keys. The demo's theme
 * is there too, as `demo.theme` (`THEME_STORAGE_KEYS` in `themes/registry.ts`); the first-paint
 * script moves its legacy key, since it runs before this module.
 *
 * Demo and account data never mix: signing in doesn't import the demo's data, signing out
 * doesn't copy the account's into the demo, and signed-in code never reads a demo key.
 */

export const DEMO_STORAGE_PREFIX = "demo.";

type DemoSection = "goals" | "annotations" | "preferences";

/** The key a demo section lives under: `demo.goals.2026.cycling`, `demo.annotations.2026`, `demo.preferences`. */
export function demoConfigKey(section: DemoSection, year?: number, sport?: string): string {
  if (section === "goals" && year !== undefined && sport !== undefined) {
    return `${DEMO_STORAGE_PREFIX}goals.${year}.${sport}`;
  }
  if (year !== undefined) return `${DEMO_STORAGE_PREFIX}${section}.${year}`;
  return `${DEMO_STORAGE_PREFIX}${section}`;
}

/** A demo section's stored JSON, or null when there is none. Parsing and validating are the caller's. */
export function readDemoSection(
  section: DemoSection,
  year?: number,
  sport?: string
): string | null {
  return localStorage.getItem(demoConfigKey(section, year, sport));
}

/** Save a demo section under its key. Throws if localStorage refuses the write. */
export function saveDemoSection(
  section: DemoSection,
  data: unknown,
  year?: number,
  sport?: string
): void {
  localStorage.setItem(demoConfigKey(section, year, sport), JSON.stringify(data));
}

/**
 * The keys the demo used before it had its own namespace. `demo_goals_*` comes before
 * `userConfig_anonymous_goals_*` because the demo page wrote it; the other was the sign-in
 * migration's key, which nothing in the demo UI wrote.
 */
const LEGACY_KEYS: { match: RegExp; to: (m: RegExpMatchArray) => string }[] = [
  {
    match: /^demo_goals_(.+)_(\d{4})$/,
    to: (m) => demoConfigKey("goals", Number(m[2]), m[1]),
  },
  {
    match: /^userConfig_anonymous_goals_(\d{4})_(.+)$/,
    to: (m) => demoConfigKey("goals", Number(m[1]), m[2]),
  },
  {
    match: /^userConfig_anonymous_annotations_(\d{4})$/,
    to: (m) => demoConfigKey("annotations", Number(m[1])),
  },
  { match: /^userConfig_anonymous_preferences$/, to: () => demoConfigKey("preferences") },
];

/**
 * Move the demo's data from its old keys into the namespace and remove the old keys. Safe to
 * run on every load: an entry already under the new key wins, so a newer demo save is never
 * overwritten. Storage that throws (private browsing, blocked site data) is left alone.
 */
export function moveLegacyDemoStorage(storage: Storage = localStorage): void {
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => key !== null
    );
    for (const { match, to } of LEGACY_KEYS) {
      for (const key of keys) {
        const found = key.match(match);
        if (!found) continue;
        const value = storage.getItem(key);
        const target = to(found);
        if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
        storage.removeItem(key);
      }
    }
  } catch {
    // Nothing to move when storage is unavailable.
  }
}

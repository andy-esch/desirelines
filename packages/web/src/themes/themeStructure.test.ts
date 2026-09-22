import { describe, it, expect } from "vitest";
import { THEMES } from "./registry";

/**
 * A structure field only means something if some component reads it. Eight of them were
 * declared, given a value in every theme, and never read: the themes that set them rendered
 * identically whatever the value said, and nothing failed. This walks the field names against
 * the source tree so the next one cannot be declared and forgotten.
 *
 * It proves a field is mentioned, not that it is wired correctly — the per-field tests beside
 * each component do that. Here it is the cheap check that catches a whole field going dark.
 */
const sources: Record<string, string> = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  eager: true,
  import: "default",
});

const structureFields = Object.keys(THEMES[0]?.structure ?? {});

/**
 * The registry declares and sets the fields, so it can never be the consumer. Match the end
 * of the path: `import.meta.glob` keys are relative to this file, so the registry arrives as
 * `./registry.ts` and a directory-qualified check silently lets it through — which is exactly
 * how this test first passed while eight fields had no reader at all.
 */
const consumerSources = Object.entries(sources).filter(
  ([path]) => !/(^|\/)registry\.ts$/.test(path) && !/\.test\.tsx?$/.test(path)
);

describe("theme structure fields", () => {
  it("covers every field in the theme list", () => {
    expect(structureFields.length).toBeGreaterThan(0);
  });

  it("has a consumer for every field", () => {
    const unread = structureFields.filter((field) => {
      const mention = new RegExp(`\\b${field}\\b`);
      return !consumerSources.some(([, text]) => mention.test(text));
    });
    expect(unread).toEqual([]);
  });
});

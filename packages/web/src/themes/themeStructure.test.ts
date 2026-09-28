import { describe, it, expect } from "vitest";
import { STRUCTURE_OPTIONS, THEMES, type ThemeStructure } from "./registry";
import styleGuide from "../../docs/style-guide.md?raw";

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

const structureFields = Object.keys(STRUCTURE_OPTIONS) as (keyof ThemeStructure)[];

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

  it("offers only options some theme in the list picks", () => {
    const unused = structureFields.flatMap((field) =>
      STRUCTURE_OPTIONS[field]
        .filter((option) => !THEMES.some((theme) => theme.structure[field] === option))
        .map((option) => `${field}: ${String(option)}`)
    );
    expect(unused).toEqual([]);
  });

  it("lists each field and its options in the style guide's table", () => {
    const start = styleGuide.indexOf("Structure fields (`structure` on the list entry):");
    const table = styleGuide.slice(
      start,
      styleGuide.indexOf("\n\n", styleGuide.indexOf("|", start))
    );
    const documented = Object.fromEntries(
      [...table.matchAll(/^\| `(\w+)` \| ([^|]+) \|/gm)].map(([, field, values]) => [
        field,
        [...values!.matchAll(/`([^`]+)`/g)].map(([, value]) => value).sort(),
      ])
    );
    const declared = Object.fromEntries(
      structureFields.map((field) => [field, STRUCTURE_OPTIONS[field].map(String).sort()])
    );
    expect(documented).toEqual(declared);
  });

  it("has a consumer for every field", () => {
    const unread = structureFields.filter((field) => {
      const mention = new RegExp(`\\b${field}\\b`);
      return !consumerSources.some(([, text]) => mention.test(text));
    });
    expect(unread).toEqual([]);
  });
});

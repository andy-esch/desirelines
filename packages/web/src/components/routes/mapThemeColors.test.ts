import { describe, it, expect } from "vitest";
import { transform } from "lightningcss";
import { Color } from "mapbox-gl/dist/style-spec/index.es.js";
import { toMapboxColor } from "../../utils/colorTokens";

/**
 * Theme colors RouteMap hands to Mapbox paint still parse after the production build.
 *
 * Mapbox can't take var(), so RouteMap reads these tokens off <html> as values, and a
 * custom property reads back exactly as the stylesheet wrote it. The production CSS
 * minifier rewrites a color to its shortest form, so `rgba(0, 0, 0, 0)` ships as `#0000`,
 * which Mapbox's color parser rejects; the map then fails to add the layer. Each value
 * goes through the same minifier here, then through toMapboxColor, and must parse.
 */
const sheets = import.meta.glob<string>(["../../css/tailwind.css", "../../css/themes/*.css"], {
  query: "?raw",
  eager: true,
  import: "default",
});

/** The color tokens RouteMap resolves for Mapbox paint. */
const MAP_PAINT_TOKENS = ["--color-map-route-casing", "--color-map-point-outline"];

/** A token value as the production minifier writes it. */
function minified(value: string): string {
  const css = transform({
    filename: "token.css",
    code: new TextEncoder().encode(`:root{--t:${value}}`),
    minify: true,
  }).code;
  return /--t:(.*)\}/.exec(new TextDecoder().decode(css))![1]!;
}

const declarations = Object.entries(sheets).flatMap(([path, text]) =>
  MAP_PAINT_TOKENS.flatMap((token) =>
    [...text.matchAll(new RegExp(`${token}:\\s*([^;]+);`, "g"))].map(
      ([, value]) => [`${path} ${token}`, value!.trim()] as const
    )
  )
);

describe("map paint colors from the theme", () => {
  it("checks every token, with the default stylesheet setting each", () => {
    for (const token of MAP_PAINT_TOKENS) {
      expect(declarations.some(([label]) => label.endsWith(`tailwind.css ${token}`))).toBe(true);
    }
  });

  it.each(declarations)("%s parses in Mapbox once minified", (_label, value) => {
    expect(Color.parse(toMapboxColor(minified(value)))).toBeTruthy();
  });

  it("would not parse unconverted, which is why toMapboxColor exists", () => {
    expect(minified("rgba(0, 0, 0, 0)")).toBe("#0000");
    expect(Color.parse("#0000")).toBeFalsy();
  });
});

import type { SlotKind } from "../themes/contract";

/**
 * Whether a theme value is the kind of value the contract says its slot holds. The value
 * has its `var()` references resolved first (see `resolveVars`), so it is checked as the
 * browser would compute it at the theme root.
 *
 * The grammar is the one theme files write, not all of CSS: a new form fails here until
 * this learns it, which is the point.
 */
export function isKind(kind: SlotKind, value: string, keywords: readonly string[] = []): boolean {
  const v = value.trim();
  if (keywords.includes(v)) return true;
  return CHECKS[kind](v);
}

const NUMBER = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`;
const LENGTH = new RegExp(`^${NUMBER}(?:px|rem|em|%|vh|vw|ch|lh)$`);
const isLength = (v: string) => LENGTH.test(v);

/** Split on separators outside parentheses: commas between layers, spaces between parts. */
export function splitTop(value: string, separator: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (separator === " " ? /\s/.test(ch) : ch === separator)) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isColor(v: string): boolean {
  if (v === "transparent" || v === "currentColor") return true;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (
    /^rgba?\(\s*\d{1,3}(?:\s*,\s*|\s+)\d{1,3}(?:\s*,\s*|\s+)\d{1,3}(?:\s*[,/]\s*(?:\d*\.?\d+%?))?\s*\)$/.test(
      v
    )
  )
    return true;
  const mix = v.match(/^color-mix\(in [a-z-]+\s*,(.*)\)$/)?.[1];
  if (mix === undefined) return false;
  const stops = splitTop(mix, ",");
  return (
    stops.length === 2 &&
    stops.every((stop) => {
      const parts = splitTop(stop, " ");
      const pct = parts.length === 2 ? parts.pop() : undefined;
      return (
        parts.length === 1 && isColor(parts[0]!) && (pct === undefined || /^[\d.]+%$/.test(pct))
      );
    })
  );
}

/** A shadow layer: 2 to `maxLengths` lengths, at most one color, and `inset` if allowed. */
function isShadowLayer(layer: string, maxLengths: number, allowInset: boolean): boolean {
  const parts = splitTop(layer, " ");
  const insets = parts.filter((p) => p === "inset").length;
  const lengths = parts.filter((p) => p === "0" || isLength(p)).length;
  const colors = parts.filter((p) => p !== "inset" && p !== "0" && !isLength(p));
  return (
    (allowInset || insets === 0) &&
    insets <= 1 &&
    lengths >= 2 &&
    lengths <= maxLengths &&
    colors.length <= 1 &&
    colors.every(isColor)
  );
}

const layers = (v: string, check: (layer: string) => boolean) =>
  v === "none" || (splitTop(v, ",").length > 0 && splitTop(v, ",").every(check));

const CHECKS: Readonly<Record<SlotKind, (v: string) => boolean>> = {
  color: isColor,
  length: isLength,
  lengths: (v) => {
    const parts = splitTop(v, " ");
    return parts.length >= 1 && parts.length <= 4 && parts.every(isLength);
  },
  percentage: (v) => new RegExp(`^${NUMBER}%$`).test(v),
  number: (v) => new RegExp(`^${NUMBER}$`).test(v),
  weight: (v) => /^(?:[1-9]00|normal|bold)$/.test(v),
  tracking: (v) => v === "normal" || isLength(v),
  case: (v) => /^(?:none|uppercase|lowercase|capitalize)$/.test(v),
  font: (v) =>
    splitTop(v, ",").every((family) =>
      /^(?:"[^"]+"|'[^']+'|-?[a-z][\w-]*(?: [a-z][\w-]*)*)$/i.test(family)
    ),
  shadow: (v) => layers(v, (layer) => isShadowLayer(layer, 4, true)),
  "text-shadow": (v) => layers(v, (layer) => isShadowLayer(layer, 3, false)),
  "inset-glow": (v) => splitTop(v, ",").length === 1 && isShadowLayer(v, 4, false),
  border: (v) => {
    if (v === "none") return true;
    const parts = splitTop(v, " ");
    return (
      parts.length === 3 &&
      isLength(parts[0]!) &&
      /^(?:solid|dashed|dotted|double)$/.test(parts[1]!) &&
      isColor(parts[2]!)
    );
  },
  image: (v) => v === "none" || /^(?:repeating-)?(?:linear|radial|conic)-gradient\(.+\)$/.test(v),
  filter: (v) =>
    v === "none" ||
    splitTop(v, " ").every((fn) =>
      /^(?:blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|opacity|saturate|sepia)\(.+\)$/.test(
        fn
      )
    ),
  dash: (v) => /^\d+(?:\.\d+)?(?:[ ,]+\d+(?:\.\d+)?)*$/.test(v),
};

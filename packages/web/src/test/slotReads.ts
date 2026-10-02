import { slotSpec, type SlotKind } from "../themes/contract";

/**
 * Where each theme slot is read, and whether the slot's kind belongs there: the scan behind
 * the "read as its kind" test in `themeTokenUse.test.ts`.
 *
 * A read is placed by what consumes it: a CSS property (in a stylesheet, a Tailwind
 * arbitrary property such as `[box-shadow:var(--x)]`, an inline style key or an SVG
 * attribute), a Tailwind utility (`rounded-(--x)`, `text-(length:--x)`, `bg-[var(--x)]`),
 * a custom property declared from it, or a color helper (`tint("--x")`, `alpha("var(--x)")`).
 *
 * A `var()` that is the whole value, or one item of a comma-separated list such as a
 * `box-shadow`, must hold a kind the position takes. A `var()` inside a larger value is a
 * part: inside `color-mix()` it must be a color, inside `calc()` a number or length, and
 * elsewhere (a shadow's offset, a border's color) a plain color, length or number.
 */

/** What a slot read sits in, and the kinds that read can hold. */
export interface SlotRead {
  file: string;
  slot: string;
  /** The CSS property, utility or helper that consumes the read. */
  position: string;
  kinds: readonly SlotKind[];
}

const COLOR: readonly SlotKind[] = ["color"];
const LENGTH: readonly SlotKind[] = ["length", "percentage"];
const LENGTHS: readonly SlotKind[] = ["length", "lengths", "percentage"];
const NUMERIC: readonly SlotKind[] = ["length", "percentage", "number"];
/** What a part of a larger value can be. */
const PART: readonly SlotKind[] = ["color", "length", "percentage", "number"];

/** The kinds a CSS property takes as its whole value. */
const PROPERTY_KINDS: ReadonlyArray<[RegExp, readonly SlotKind[]]> = [
  [
    /^(?:color|background-color|border(?:-(?:top|right|bottom|left|inline|block))?-color|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color|stop-color|-webkit-text-fill-color|--tw-(?:shadow|ring|inset-shadow)-color)$/,
    COLOR,
  ],
  [/^background$/, ["image", "color"]],
  [/^(?:background-image|border-image(?:-source)?)$/, ["image"]],
  [/^(?:box-shadow|--tw-(?:ring-)?shadow)$/, ["shadow"]],
  [/^text-shadow$/, ["text-shadow"]],
  [/^(?:backdrop-)?filter$/, ["filter"]],
  [/^font-family$/, ["font"]],
  [/^font-weight$/, ["weight"]],
  [/^letter-spacing$/, ["tracking"]],
  [/^text-transform$/, ["case"]],
  [/^(?:border(?:-(?:top|right|bottom|left|inline|block))?|outline)$/, ["border"]],
  [/^(?:padding|margin)(?:-[a-z]+)?$/, LENGTHS],
  [/^line-height$/, NUMERIC],
  [
    /^(?:font-size|border(?:-[a-z]+)*-radius|(?:min-|max-)?(?:width|height)|(?:row-|column-)?gap|inset(?:-[a-z]+)?|top|right|bottom|left|border(?:-[a-z]+)?-width|outline-(?:width|offset)|translate|blur)$/,
    LENGTH,
  ],
  [/^(?:opacity)$/, ["number", "percentage"]],
  [/^stroke-dasharray$/, ["dash"]],
  [/^stroke-width$/, ["length", "number"]],
];

/** The CSS property a Tailwind utility sets, by its name and an optional type hint. */
function utilityProperty(utility: string, hint: string | undefined): string | undefined {
  const name = utility.replace(/^-/, "");
  if (name === "text") return hint === "length" ? "font-size" : "color";
  if (/^border(?:-[trblxyse])?$/.test(name))
    return hint === "length" ? "border-width" : "border-color";
  if (name === "bg") return hint === "image" ? "background-image" : "background-color";
  if (name === "font") return hint === "weight" ? "font-weight" : "font-family";
  if (name === "shadow") return hint === "color" ? "--tw-shadow-color" : "box-shadow";
  if (name === "ring") return hint === "length" ? "border-width" : "--tw-ring-color";
  if (name === "outline") return hint === "length" ? "outline-width" : "outline-color";
  if (name === "stroke") return hint === "length" ? "stroke-width" : "stroke";
  const fixed: Record<string, string> = {
    tracking: "letter-spacing",
    leading: "line-height",
    fill: "fill",
    decoration: "text-decoration-color",
    accent: "accent-color",
    caret: "caret-color",
    from: "color",
    via: "color",
    to: "color",
    opacity: "opacity",
    blur: "blur",
    "backdrop-blur": "blur",
    "outline-offset": "outline-offset",
  };
  if (name in fixed) return fixed[name];
  if (/^rounded(?:-[trblse]{1,2})?$/.test(name)) return "border-radius";
  if (/^(?:p|m)[xytrblse]?$/.test(name)) return name.startsWith("p") ? "padding" : "margin";
  if (/^(?:min-|max-)?[wh]$/.test(name)) return name.endsWith("w") ? "width" : "height";
  if (name === "size") return "width";
  if (/^gap(?:-[xy])?$/.test(name)) return "gap";
  if (/^(?:inset(?:-[xy])?|top|right|bottom|left|start|end)$/.test(name)) return "inset";
  if (/^translate-[xy]$/.test(name)) return "translate";
  return undefined;
}

/** The kinds a position takes as its whole value, when the scan knows the position. */
export function kindsAt(position: string): readonly SlotKind[] | undefined {
  // An inset-shadow utility adds the `inset` an inset-glow slot leaves out.
  if (position === "inset-shadow") return ["inset-glow"];
  const asSlot = slotSpec(position);
  if (asSlot) return [asSlot.kind];
  // Tailwind's theme namespaces, for the aliases tailwind.css declares.
  if (/^--color-/.test(position)) return COLOR;
  if (/^--(?:radius|spacing|text)-/.test(position)) return LENGTH;
  if (/^--font-/.test(position)) return ["font"];
  if (/^--shadow-/.test(position)) return ["shadow"];
  return PROPERTY_KINDS.find(([pattern]) => pattern.test(position))?.[1];
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The extent of the `var(` call starting at `start`: the index after its closing paren. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

/**
 * The kinds a `var()` at `at` in a value can hold: the position's own when it is the whole
 * value or a whole list item (a fallback of such a `var()` counts as one too), otherwise
 * what a part in its context can be.
 */
function readKinds(
  value: string,
  at: number,
  whole: readonly SlotKind[] | undefined
): readonly SlotKind[] | undefined {
  // Walk out through any `var(` this one is the fallback of.
  let start = at;
  for (;;) {
    let depth = 0;
    let open = -1;
    for (let i = start - 1; i >= 0; i--) {
      if (value[i] === ")") depth++;
      else if (value[i] === "(" && depth-- === 0) {
        open = i;
        break;
      }
    }
    if (open < 0) break;
    const fn = /([\w-]*)$/.exec(value.slice(0, open))?.[1] ?? "";
    if (fn === "var") {
      start = open - 3;
      continue;
    }
    // color-mix() takes colors and the percentages to mix them by.
    if (fn === "color-mix") return ["color", "percentage"];
    if (/\bfrom\s*$/.test(value.slice(open + 1, start))) return COLOR;
    if (/^(?:calc|min|max|clamp)$/.test(fn)) return NUMERIC;
    return PART;
  }
  const end = closeOf(value, start + 3);
  // A background layer's box (`var(--x) border-box`) is part of the layer, not the value.
  const box = /^(?:(?:padding|border|content)-box\s*)+/;
  const before = value.slice(0, start).trim();
  const after = value.slice(end).trim().replace(box, "").trim();
  const alone = (before === "" || before.endsWith(",")) && (after === "" || after.startsWith(","));
  return alone ? whole : PART;
}

/** Every `var(--slot)` in a value, placed at a position. */
function varsIn(file: string, value: string, position: string): SlotRead[] {
  const whole = kindsAt(position);
  return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].flatMap((match) => {
    const slot = match[1]!;
    if (!slotSpec(slot)) return [];
    const kinds = readKinds(value, match.index, whole);
    return [{ file, slot, position, kinds: kinds ?? [] }];
  });
}

/** The slot reads in a file's comment-free text, placed where the scan can place them. */
export function slotReadsIn(file: string, text: string): SlotRead[] {
  const reads: SlotRead[] = [];

  if (file.endsWith(".css")) {
    // Declarations, custom properties included, and the utilities an @apply names.
    for (const [, property = "", value = ""] of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      if (property.startsWith("--") && slotSpec(property) === undefined && !value.includes("var("))
        continue;
      reads.push(...varsIn(file, value, property));
    }
  } else {
    // Inline style keys, SVG attributes and config entries holding a value with a var(): each
    // string around a var(), found from the var() out so a stray quote elsewhere can't
    // misalign it.
    const strings = new Map<number, string>();
    for (const { index } of text.matchAll(/var\(--/g)) {
      const open = Math.max(
        text.lastIndexOf('"', index),
        text.lastIndexOf("'", index),
        text.lastIndexOf("`", index)
      );
      if (open < 0) continue;
      const close = text.indexOf(text[open]!, index);
      if (close > 0) strings.set(open, text.slice(open + 1, close));
    }
    for (const [open, value] of strings) {
      if (value.includes("[") || /(?:^|\s)[\w-]+-\(/.test(value)) continue; // a class list
      const before = text.slice(Math.max(0, open - 120), open);
      // Less a ternary's first branch (`on ? "var(--a)" : `), for the key the ternary sets.
      const lead = before.replace(/["'`][^"'`]*["'`]\s*:\s*$/, "");
      const helper = /\b(?:alpha|tint|resolveThemeColor)\(\s*$/.test(before);
      // A custom property a style object declares, or a style key or SVG attribute.
      const key =
        /["'](--[\w-]+)["']\s*:\s*$/.exec(before)?.[1] ??
        /([A-Za-z]\w*)\s*[:=]\s*\{?[^"'`,;{}:]*$/.exec(lead)?.[1];
      if (helper) {
        reads.push(
          ...varsIn(file, value, "color").map((read) => ({ ...read, position: "color helper" }))
        );
      } else if (key && kindsAt(kebab(key))) {
        reads.push(...varsIn(file, value, key.startsWith("--") ? key : kebab(key)));
      }
    }
    // Token names handed to a color helper.
    for (const match of text.matchAll(/\b(tint|resolveThemeColor)\(\s*["'`](--[\w-]+)["'`]/g)) {
      if (slotSpec(match[2]!))
        reads.push({ file, slot: match[2]!, position: match[1]!, kinds: COLOR });
    }
  }

  // Tailwind arbitrary properties: [box-shadow:var(--x)].
  for (const [, property = "", value = ""] of text.matchAll(
    /(?<=^|[\s"'`:])\[([a-z-]+):([^\]\s"'`]+)\]/g
  )) {
    reads.push(...varsIn(file, value.replaceAll("_", " "), property));
  }
  // Tailwind shorthand utilities: rounded-(--x), text-(length:--x), inset-shadow-(--x).
  for (const match of text.matchAll(
    /(?<![\w-])(-?[a-z][a-z0-9-]*?)-\((?:([a-z-]+):)?(--[\w-]+)\)/g
  )) {
    const [, utility = "", hint, slot = ""] = match;
    if (!slotSpec(slot)) continue;
    const position = utility === "inset-shadow" ? "inset-shadow" : utilityProperty(utility, hint);
    reads.push({
      file,
      slot,
      position: position ?? `${utility}-()`,
      kinds: (position === undefined ? undefined : kindsAt(position)) ?? [],
    });
  }
  // Tailwind arbitrary values: bg-[var(--x)], rounded-[min(var(--x),3px)].
  for (const match of text.matchAll(
    /(?<![\w-])(-?[a-z][a-z0-9-]*?)-\[(?:([a-z-]+):)?([^\]\s"'`]*var\([^\]\s"'`]*)\]/g
  )) {
    const [, utility = "", hint, value = ""] = match;
    const position = utility === "inset-shadow" ? "box-shadow" : utilityProperty(utility, hint);
    reads.push(...varsIn(file, value.replaceAll("_", " "), position ?? `${utility}-[]`));
  }
  return reads;
}

/**
 * How many times a file reads each slot, declarations aside: what the placed reads should
 * account for.
 */
export function slotMentionsIn(file: string, text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/--[\w-]+(?![\w-])/g)) {
    const slot = match[0];
    if (!slotSpec(slot)) continue;
    const next = text
      .slice(match.index + slot.length)
      .replace(/^["'`]/, "")
      .trimStart();
    const declared =
      next.startsWith(":") && (file.endsWith(".css") || /["'`[]$/.test(text.slice(0, match.index)));
    if (declared) continue;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  return counts;
}

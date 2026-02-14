#!/usr/bin/env node
/**
 * Bootstrap → Tailwind CSS utility class migration script.
 *
 * Converts Bootstrap utility classes to Tailwind equivalents in TSX/TS files.
 * Only handles utility classes — component classes (btn, alert, table, card, etc.)
 * are left for manual migration with dashboard.css.
 *
 * Usage: node scripts/migrate-bootstrap-to-tailwind.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from "fs";
import { globSync } from "fs";
import { execSync } from "child_process";

const DRY_RUN = process.argv.includes("--dry-run");

// Find all TSX/TS files (excluding test files, node_modules, and this script)
const files = execSync(
  'find src -type f \\( -name "*.tsx" -o -name "*.ts" \\) ! -name "*.test.*" ! -name "*.spec.*" ! -path "*/node_modules/*"',
  { encoding: "utf-8" }
)
  .trim()
  .split("\n")
  .filter(Boolean);

/**
 * Mapping of Bootstrap classes → Tailwind classes.
 *
 * Bootstrap spacing scale: 0=0, 1=0.25rem, 2=0.5rem, 3=1rem, 4=1.5rem, 5=3rem
 * Tailwind spacing scale:  0=0, 1=0.25rem, 2=0.5rem, 3=0.75rem, 4=1rem, 5=1.25rem, 6=1.5rem, 8=2rem, 12=3rem
 *
 * BS→TW mapping: 0→0, 1→1, 2→2, 3→4, 4→6, 5→12
 */
const SPACING_MAP = { "0": "0", "1": "1", "2": "2", "3": "4", "4": "6", "5": "12" };

// Build spacing replacements for all sides
const spacingReplacements = [];
for (const [bs, tw] of Object.entries(SPACING_MAP)) {
  // margin
  spacingReplacements.push([`mb-${bs}`, `mb-${tw}`]);
  spacingReplacements.push([`mt-${bs}`, `mt-${tw}`]);
  spacingReplacements.push([`ms-${bs}`, `ms-${tw}`]);
  spacingReplacements.push([`me-${bs}`, `me-${tw}`]);
  spacingReplacements.push([`mx-${bs}`, `mx-${tw}`]);
  spacingReplacements.push([`my-${bs}`, `my-${tw}`]);
  spacingReplacements.push([`m-${bs}`, `m-${tw}`]);
  // padding
  spacingReplacements.push([`pb-${bs}`, `pb-${tw}`]);
  spacingReplacements.push([`pt-${bs}`, `pt-${tw}`]);
  spacingReplacements.push([`ps-${bs}`, `ps-${tw}`]);
  spacingReplacements.push([`pe-${bs}`, `pe-${tw}`]);
  spacingReplacements.push([`px-${bs}`, `px-${tw}`]);
  spacingReplacements.push([`py-${bs}`, `py-${tw}`]);
  spacingReplacements.push([`p-${bs}`, `p-${tw}`]);
  // gap
  spacingReplacements.push([`gap-${bs}`, `gap-${tw}`]);
  // grid gutter
  spacingReplacements.push([`g-${bs}`, `gap-${tw}`]);
}

/**
 * Static class replacements — Bootstrap class → Tailwind class.
 * Order matters: longer/more specific patterns first.
 */
const REPLACEMENTS = [
  // Display
  ["d-inline-flex", "inline-flex"],
  ["d-flex", "flex"],
  ["d-inline-block", "inline-block"],
  ["d-inline", "inline"],
  ["d-block", "block"],
  ["d-none", "hidden"],
  ["d-grid", "grid"],

  // Responsive display
  ["d-md-flex", "md:flex"],
  ["d-md-none", "md:hidden"],
  ["d-md-block", "md:block"],
  ["d-md-inline", "md:inline"],
  ["d-lg-flex", "lg:flex"],
  ["d-lg-none", "lg:hidden"],
  ["d-lg-block", "lg:block"],
  ["d-xl-flex", "xl:flex"],
  ["d-xl-none", "xl:hidden"],
  ["d-xl-block", "xl:block"],

  // Flexbox
  ["flex-column", "flex-col"],
  ["flex-grow-1", "grow"],
  ["flex-shrink-0", "shrink-0"],
  ["flex-md-nowrap", "md:flex-nowrap"],
  // flex-wrap is the same in both

  // Alignment
  ["align-items-start", "items-start"],
  ["align-items-center", "items-center"],
  ["align-items-end", "items-end"],
  ["align-items-baseline", "items-baseline"],
  ["align-items-stretch", "items-stretch"],
  ["align-self-center", "self-center"],
  ["align-self-start", "self-start"],
  ["align-self-end", "self-end"],
  ["justify-content-start", "justify-start"],
  ["justify-content-center", "justify-center"],
  ["justify-content-end", "justify-end"],
  ["justify-content-between", "justify-between"],
  ["justify-content-around", "justify-around"],
  ["justify-content-evenly", "justify-evenly"],

  // Text
  ["text-body-secondary", "text-slate-light"],
  ["text-uppercase", "uppercase"],
  ["text-lowercase", "lowercase"],
  ["text-capitalize", "capitalize"],
  ["text-nowrap", "whitespace-nowrap"],
  ["text-decoration-none", "no-underline"],
  ["text-center", "text-center"], // same
  ["text-end", "text-right"],
  ["text-start", "text-left"],
  // text-muted → text-slate-light (our custom theme color)
  ["text-muted", "text-slate-light"],
  ["text-white-50", "text-white/50"],
  // text-white, text-danger, text-success, text-warning → keep semantic but with Tailwind colors
  // Leave text-white as is (same in Tailwind)

  // Font weight
  ["fw-semibold", "font-semibold"],
  ["fw-medium", "font-medium"],
  ["fw-bold", "font-bold"],
  ["fw-normal", "font-normal"],

  // Font size
  // "small" as a class → "text-sm" but be careful to only match as a class
  // We'll handle this separately with word boundary matching

  // Sizing
  ["w-100", "w-full"],
  ["h-100", "h-full"],

  // Position
  ["position-relative", "relative"],
  ["position-absolute", "absolute"],
  ["position-static", "static"],
  ["sticky-top", "sticky top-0"],

  // Overflow
  ["overflow-hidden", "overflow-hidden"], // same
  ["overflow-auto", "overflow-auto"], // same
  ["overflow-y-auto", "overflow-y-auto"], // same (custom in both)

  // Float
  ["float-end", "float-right"],
  ["float-start", "float-left"],

  // Border
  ["border-top", "border-t"],
  ["border-bottom", "border-b"],
  ["border-start", "border-l"],
  ["border-end", "border-r"],
  ["border-0", "border-0"],
  ["rounded-0", "rounded-none"],
  // border, rounded → same in both

  // Visibility
  ["visually-hidden", "sr-only"],

  // Background
  ["bg-transparent", "bg-transparent"], // same

  // Responsive grid helpers (common patterns)
  ["col-auto", "col-auto"], // will be handled manually

  // Container (these need careful handling)
  // container-fluid → just use w-full + px padding
  // container → Tailwind container

  // Heading classes (Bootstrap typography)
  // h1, h2, h3 as classes → just use text size classes

  // mt-auto (push to bottom in flex) → same in Tailwind
  ["mt-auto", "mt-auto"], // same

  // Spacing (generated above)
  ...spacingReplacements,
];

/**
 * Replace Bootstrap classes within a className string.
 * Handles: className="..." and className={`...`} patterns.
 */
function replaceClasses(content) {
  let result = content;

  for (const [from, to] of REPLACEMENTS) {
    if (from === to) continue; // Skip no-ops

    // Replace as whole word within className strings
    // Match the class as a word boundary (surrounded by spaces, quotes, backticks, or string boundaries)
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `(?<=[" \`{])${escaped}(?=[" \`}])`,
      "g"
    );
    result = result.replace(regex, to);
  }

  // Handle "small" → "text-sm" (only as a CSS class, not in other contexts)
  // Match "small" when it appears in className context (preceded by " or space, followed by " or space)
  result = result.replace(/(?<=[" `{])small(?=[" `}])/g, "text-sm");

  return result;
}

// Process files
let changedCount = 0;
const changes = [];

for (const file of files) {
  const original = readFileSync(file, "utf-8");
  const converted = replaceClasses(original);

  if (original !== converted) {
    changedCount++;
    if (DRY_RUN) {
      changes.push(file);
    } else {
      writeFileSync(file, converted, "utf-8");
      changes.push(file);
    }
  }
}

console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Modified ${changedCount} files:\n`);
changes.forEach((f) => console.log(`  ${f}`));
console.log();

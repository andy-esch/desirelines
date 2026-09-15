import { Fragment, useCallback, useId, useState, type CSSProperties } from "react";
import {
  THEMES,
  type MapPalette,
  type ThemeDefinition,
  type ThemeMap,
} from "../../themes/registry";
import { RETRO_BASE_MAPS } from "../../themes/baseMaps";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import KPICard from "../../components/dashboard/KPICard";
import SportFilterPills from "../../components/SportFilterPills";
import { SPORT_COLORS } from "../../utils/sportConfig";
import { ThemeStructureProvider } from "../../components/theme/ThemeStructureProvider";
import { Panel } from "../../components/theme/Panel";
import { SectionLabel } from "../../components/theme/SectionLabel";
import { Stat, StatRow } from "../../components/theme/Stat";
import { Meter } from "../../components/theme/Meter";
import { StatusSymbol, type GoalStatus } from "../../components/theme/StatusSymbol";

/**
 * Dev-only theme gallery: every theme in the list — hidden ones included — rendered side
 * by side. Each panel sets `data-theme` on its own subtree, which is why every CSS theme
 * block defines the full token set (see themeCss.test.ts).
 *
 * The review surface for theme and component work: check a change here in every theme
 * before checking it on real pages. Reached at /dev/themes; never bundled in production.
 */

const SAMPLE_SPORTS = [
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "hiking", label: "Hiking" },
  { value: "watersports", label: "Watersports" },
];

/**
 * The custom properties a theme block declares, read from the loaded stylesheets so the
 * swatch grid follows tailwind.css without a hand-kept list. The app stylesheet is in the
 * document before React renders, so a one-time read at mount is enough.
 *
 * Walks nested rules: the CSS build nests an `@supports` fallback inside the theme rule
 * after each `color-mix()` token, which turns every declaration after it into a nested
 * declarations rule — so reading only the theme rule's own `style` sees part of the block.
 */
function readThemeTokenNames(themeId: string): string[] {
  const found = new Set<string>();
  const visit = (rules: CSSRuleList, inTheme: boolean) => {
    for (const rule of Array.from(rules)) {
      const collecting =
        inTheme ||
        (rule instanceof CSSStyleRule && rule.selectorText.includes(`data-theme="${themeId}"`));
      if (collecting && "style" in rule) {
        for (const name of Array.from(rule.style)) {
          if (name.startsWith("--")) found.add(name);
        }
      }
      if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules, collecting);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules, false);
    } catch {
      // cross-origin sheet
    }
  }
  return [...found];
}

function TokenSwatches({ names }: { names: string[] }) {
  if (names.length === 0) {
    return <p className="text-sm text-muted-text">No tokens found for this theme.</p>;
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1.5 text-xs">
      {names.map((name) => (
        <li key={name} className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-sm border border-border"
            style={{ background: `var(${name})` }}
          />
          <code className="truncate">{name.replace(/^--color-/, "")}</code>
        </li>
      ))}
    </ul>
  );
}

/**
 * Non-color slots with their resolved values. The values are read from the themed panel
 * once it is in the document, so they show what that theme's block actually applies.
 */
function SlotValues({ names }: { names: string[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const measure = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const style = getComputedStyle(el);
      setValues(
        Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]))
      );
    },
    [names]
  );
  return (
    <dl
      ref={measure}
      className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs"
    >
      {names.map((name) => (
        <Fragment key={name}>
          <dt>
            <code className="truncate block">{name}</code>
          </dt>
          <dd className="m-0 min-w-0">
            <code className="truncate block text-muted-text" title={values[name]}>
              {values[name] ?? ""}
            </code>
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The theme-list half: faces to preload and the structural choices components read. */
function StructureFields({ theme }: { theme: ThemeDefinition }) {
  const rows: [string, string][] = [
    ["fonts", theme.fonts.map((f) => `${f.family} (${f.weights.join(", ")})`).join("; ")],
    ...Object.entries(theme.structure).map(([key, value]): [string, string] => [
      key,
      String(value),
    ]),
  ];
  return (
    <dl className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(([key, value]) => (
        <Fragment key={key}>
          <dt>
            <code>{key}</code>
          </dt>
          <dd className="m-0 min-w-0">
            <code className="text-muted-text">{value}</code>
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function PaletteSwatches({ palette }: { palette: MapPalette }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-1.5">
      {(Object.keys(palette) as (keyof MapPalette)[]).map((role) => (
        <li key={role} className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-sm border border-border"
            style={{ background: palette[role] }}
          />
          <code className="truncate">
            {role} <span className="text-muted-text">{palette[role]}</span>
          </code>
        </li>
      ))}
    </ul>
  );
}

/** A theme's base-map recolor: palette swatches and label font, or the stock style. */
function BaseMapSwatches({ mapStyle, baseMap }: { mapStyle: string; baseMap: ThemeMap }) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="m-0 text-muted-text">
        <code>{mapStyle}</code>
        {baseMap.palette ? ", recolored" : ", stock colors"}
        {baseMap.labelFont ? `, labels in ${baseMap.labelFont}` : ""}
      </p>
      {baseMap.palette && <PaletteSwatches palette={baseMap.palette} />}
    </div>
  );
}

/** Base-map recolors waiting for their theme entries (see `themes/baseMaps.ts`). */
function RetroBaseMapPreview() {
  return (
    <section aria-labelledby="base-map-preview" className="flex flex-col gap-4">
      <div>
        <h2 id="base-map-preview" className="text-xl font-display">
          Base map preview
        </h2>
        <p className="text-sm text-muted-text">
          Recolors for themes whose entries aren&apos;t in the theme list yet. The routes map
          applies them over the stock style.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Object.entries(RETRO_BASE_MAPS).map(([name, baseMap]) => (
          <div
            key={name}
            className="flex flex-col gap-3 rounded-lg border border-border p-4 min-w-0"
          >
            <h3 className="text-sm font-medium capitalize">{name}</h3>
            <BaseMapSwatches mapStyle="mapbox://styles/mapbox/dark-v11" baseMap={baseMap} />
          </div>
        ))}
      </div>
    </section>
  );
}

const SAMPLE_STATUSES: [GoalStatus, string][] = [
  ["ahead", "Ahead"],
  ["slightly-behind", "Slightly behind"],
  ["behind", "Behind"],
  ["achieved", "Achieved"],
  ["no-activity", "No activity"],
];

/** Example content for the theme components; the numbers are samples, not real data. */
function ComponentSamples() {
  const dayOfYear = 256 / 365;
  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <Stat label="Current distance" value="2,175" unit="mi" sub="8.5 mi/day avg" />
        <Stat label="Conservative" value="62%" sub="1,325 mi to 3,500" accent={2} />
        <Stat
          label="Pace to conservative"
          value="12.0"
          unit="mi/day"
          sub="110 days left"
          accent={3}
          emphasis
        />
      </StatRow>
      <Panel title="Goal achievability" meta="110 days left" accent={3} emphasis>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-28 shrink-0">Conservative</span>
            <Meter
              value={0.62}
              marker={dayOfYear}
              color={SPORT_COLORS.running}
              label="Conservative progress"
              className="grow"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-28 shrink-0">Stretch</span>
            <Meter
              value={0.44}
              marker={dayOfYear}
              color={SPORT_COLORS.cycling}
              label="Stretch progress"
              className="grow"
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {SAMPLE_STATUSES.map(([status, label]) => (
              <StatusSymbol
                key={status}
                status={status}
                label={label}
                badgeStyle={{ backgroundColor: SPORT_COLORS.hiking }}
              />
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Year" meta="Day 256 of 365">
        <div className="flex flex-col gap-3">
          <Meter value={dayOfYear} segments={12} label="Year progress by month" />
          <Meter value={dayOfYear} segments={52} label="Year progress by week" />
          <Meter value={0} segments={8} label="Loading example" indeterminate />
        </div>
      </Panel>
      <div className="flex items-center gap-3">
        <SectionLabel>Section label</SectionLabel>
        <Panel className="grow">A panel with no title</Panel>
      </div>
    </div>
  );
}

/**
 * Every structure the theme components support, drawn with the surrounding theme's
 * values. Lets retro structures be reviewed before any theme uses them.
 */
function StructurePreview() {
  const base = THEMES[0].structure;
  const variants: { name: string; structure: ThemeDefinition["structure"] }[] = [
    { name: "Legacy (card headers, cards, badges, bar with percent)", structure: base },
    {
      name: "Labels above, divided stats, filled symbols, tracks, partial month",
      structure: {
        ...base,
        sectionLabelPlacement: "above",
        statRowStyle: "divided",
        statusSymbolStyle: "filled",
        goalTrackStyle: "track",
        meterPartialCurrent: true,
      },
    },
    {
      name: "Header bars, boxed stats, outlined symbols, outline tracks",
      structure: {
        ...base,
        sectionLabelPlacement: "header-bar",
        statRowStyle: "boxed",
        statusSymbolStyle: "outlined",
        goalTrackStyle: "outline-track",
      },
    },
  ];
  return (
    <section aria-labelledby="structure-preview" className="flex flex-col gap-4">
      <div>
        <h2 id="structure-preview" className="text-xl font-display">
          Structure preview
        </h2>
        <p className="text-sm text-muted-text">
          The same components in each structure a theme can choose, drawn with the page theme&apos;s
          values.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {variants.map((variant) => (
          <div
            key={variant.name}
            className="flex flex-col gap-3 rounded-lg border border-border p-4 min-w-0"
          >
            <h3 className="text-sm font-medium">{variant.name}</h3>
            <ThemeStructureProvider structure={variant.structure}>
              <ComponentSamples />
            </ThemeStructureProvider>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThemePanel({ theme }: { theme: ThemeDefinition }) {
  const [sports, setSports] = useState<string[]>(["cycling"]);
  const sportsLabelId = useId();
  const [tokens] = useState(() => {
    const names = readThemeTokenNames(theme.id);
    return {
      colors: names.filter((name) => name.startsWith("--color-")),
      slots: names.filter((name) => !name.startsWith("--color-")),
    };
  });

  return (
    <section
      data-theme={theme.id}
      aria-label={`${theme.label} theme`}
      className="bg-bg-body text-body-text rounded-lg border border-border p-4 flex flex-col gap-5 min-w-0"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-display">{theme.label}</h2>
        <code className="text-sm text-muted-text">{theme.id}</code>
        <span className="text-sm text-muted-text">
          {theme.scheme}
          {theme.hidden ? " · hidden" : ""}
        </span>
      </header>

      <div>
        <h3 className="text-sm font-medium mb-2">Color tokens</h3>
        <TokenSwatches names={tokens.colors} />
      </div>

      <details>
        <summary className="text-sm font-medium cursor-pointer">
          Slots ({tokens.slots.length})
        </summary>
        <div className="mt-2">
          <SlotValues names={tokens.slots} />
        </div>
      </details>

      <details>
        <summary className="text-sm font-medium cursor-pointer">Fonts and structure</summary>
        <div className="mt-2">
          <StructureFields theme={theme} />
        </div>
      </details>

      <div>
        <h3 className="text-sm font-medium mb-2">Base map</h3>
        <BaseMapSwatches mapStyle={theme.mapStyle} baseMap={theme.map} />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Controls</h3>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <span
            className="badge badge-sport"
            style={{ "--sport-color": SPORT_COLORS.cycling } as CSSProperties}
          >
            Cycling
          </span>
        </div>
        <Input placeholder="Input" aria-label={`Sample input, ${theme.label} theme`} />
        <div>
          <span id={sportsLabelId} className="text-sm text-muted-text">
            Sport chips
          </span>
          <SportFilterPills
            sportOptions={SAMPLE_SPORTS}
            visibleSports={SAMPLE_SPORTS.map((s) => s.value)}
            selected={sports}
            onChange={setSports}
            labelledBy={sportsLabelId}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Theme components</h3>
        <ThemeStructureProvider structure={theme.structure}>
          <ComponentSamples />
        </ThemeStructureProvider>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Surfaces</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <KPICard title="Current Distance" value="2,450 mi" subtitle="8.3 mi / day avg" />
          <Card>
            <CardHeader>
              <CardTitle>Card</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">shadcn card surface</CardContent>
          </Card>
        </div>
        <Panel bodyClassName="p-3 text-sm">Panel with no title</Panel>
        <div className="alert alert-demo text-sm">
          <strong>Demo Mode</strong> — .alert-demo
        </div>
        <p className="text-sm">
          Body text with a <a href="#gallery">link</a>,{" "}
          <span className="text-muted-text">muted</span> and{" "}
          <span className="neon-gradient-text font-medium">neon gradient</span>.
        </p>
      </div>
    </section>
  );
}

export default function ThemeGalleryPage() {
  return (
    <div id="gallery" className="px-4 md:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-display">Theme gallery</h1>
        <p className="text-sm text-muted-text">
          Dev only. Every theme in the theme list, including hidden ones, rendered side by side.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {THEMES.map((theme) => (
          <ThemePanel key={theme.id} theme={theme} />
        ))}
      </div>
      <StructurePreview />
      <RetroBaseMapPreview />
    </div>
  );
}

import { useId, useState, type CSSProperties } from "react";
import { THEMES, type ThemeDefinition } from "../../themes/registry";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import KPICard from "../../components/dashboard/KPICard";
import SportFilterPills from "../../components/SportFilterPills";
import { SPORT_COLORS } from "../../utils/sportConfig";

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

function TokenSwatches({ themeId }: { themeId: string }) {
  const [names] = useState(() => readThemeTokenNames(themeId));
  if (names.length === 0) {
    return <p className="text-sm text-slate-light">No tokens found for this theme.</p>;
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

function ThemePanel({ theme }: { theme: ThemeDefinition }) {
  const [sports, setSports] = useState<string[]>(["cycling"]);
  const sportsLabelId = useId();

  return (
    <section
      data-theme={theme.id}
      aria-label={`${theme.label} theme`}
      className="bg-bg-body text-body-text rounded-lg border border-border p-4 flex flex-col gap-5 min-w-0"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-display">{theme.label}</h2>
        <code className="text-sm text-slate-light">{theme.id}</code>
        <span className="text-sm text-slate-light">
          {theme.scheme}
          {theme.hidden ? " · hidden" : ""}
        </span>
      </header>

      <div>
        <h3 className="text-sm font-medium mb-2">Tokens</h3>
        <TokenSwatches themeId={theme.id} />
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
          <span id={sportsLabelId} className="text-sm text-slate-light">
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
        <div className="glass-panel p-3 text-sm">.glass-panel</div>
        <div className="alert alert-demo text-sm">
          <strong>Demo Mode</strong> — .alert-demo
        </div>
        <p className="text-sm">
          Body text with a <a href="#gallery">link</a>,{" "}
          <span className="text-slate-light">muted</span> and{" "}
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
        <p className="text-sm text-slate-light">
          Dev only. Every theme in the theme list, including hidden ones, rendered side by side.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {THEMES.map((theme) => (
          <ThemePanel key={theme.id} theme={theme} />
        ))}
      </div>
    </div>
  );
}

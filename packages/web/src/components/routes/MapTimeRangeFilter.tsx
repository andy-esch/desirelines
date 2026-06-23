import { Slider } from "../ui/slider";
import { Input } from "../ui/input";

export interface MapTimeRangeFilterProps {
  /** `[earliest, today]` (YYYY-MM-DD) — the full selectable domain. */
  dateDomain: [string, string];
  /** Current `[start, end]` window (YYYY-MM-DD). */
  dateRange: [string, string];
  /** Set the window. */
  onChange: (range: [string, string]) => void;
  disabled?: boolean;
}

/** Day index (UTC, TZ-safe) from a YYYY-MM-DD string. */
function ymdToDay(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86_400_000);
}
function dayToYmd(day: number): string {
  const dt = new Date(day * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Granular time-range filter: a two-thumb day slider over the full date domain +
 * synced start/end date inputs. Complements the coarse year quick-select (both
 * write the same `dateRange`); a custom range here simply leaves no year chip
 * pressed. Slider/inputs map dates ↔ UTC day indices to avoid TZ drift.
 */
export default function MapTimeRangeFilter({
  dateDomain,
  dateRange,
  onChange,
  disabled = false,
}: MapTimeRangeFilterProps) {
  const startDay = ymdToDay(dateDomain[0]);
  const endDay = ymdToDay(dateDomain[1]);
  const span = Math.max(1, endDay - startDay);
  const lo = clamp(ymdToDay(dateRange[0]) - startDay, 0, span);
  const hi = clamp(ymdToDay(dateRange[1]) - startDay, 0, span);

  const onSlider = (vals: number[]) => {
    const a = vals[0] ?? 0;
    const b = vals[1] ?? span;
    onChange([dayToYmd(startDay + a), dayToYmd(startDay + b)]);
  };
  const onStart = (v: string) => {
    if (!v) return;
    onChange([v, dateRange[1] < v ? v : dateRange[1]]); // keep start ≤ end
  };
  const onEnd = (v: string) => {
    if (!v) return;
    onChange([dateRange[0] > v ? v : dateRange[0], v]);
  };

  return (
    <section className="px-4 py-3" aria-label="Date range">
      <p
        id="filter-daterange-label"
        className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light"
      >
        Date range
      </p>
      <Slider
        aria-labelledby="filter-daterange-label"
        min={0}
        max={span}
        step={1}
        value={[lo, hi]}
        disabled={disabled}
        onValueChange={(vals) => onSlider(vals as number[])}
      />
      <div className="mt-2 flex items-center gap-2">
        <Input
          type="date"
          aria-label="Start date"
          min={dateDomain[0]}
          max={dateDomain[1]}
          value={dateRange[0]}
          disabled={disabled}
          onChange={(e) => onStart(e.target.value)}
          className="h-8 text-xs"
        />
        <span className="text-slate-light">–</span>
        <Input
          type="date"
          aria-label="End date"
          min={dateDomain[0]}
          max={dateDomain[1]}
          value={dateRange[1]}
          disabled={disabled}
          onChange={(e) => onEnd(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
    </section>
  );
}

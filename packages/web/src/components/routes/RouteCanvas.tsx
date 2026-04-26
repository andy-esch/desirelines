import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { NormalizedRoute, RouteRing } from "../../api/routes";
import { useTheme } from "../../contexts/ThemeContext";

/**
 * Color palettes ordered for maximum perceptual contrast.
 * With 2 sports → cyan vs magenta. With 3 → cyan, magenta, yellow. Etc.
 * Colors are assigned by sport index (sorted by route count), not sport name.
 */
const DARK_PALETTE = [
  "0, 255, 255", // Cyan
  "255, 0, 255", // Magenta
  "255, 200, 0", // Yellow
  "0, 255, 128", // Green
  "255, 128, 0", // Orange
  "180, 0, 255", // Purple
];

const LIGHT_PALETTE = [
  "0, 120, 200", // Deep blue
  "180, 0, 140", // Deep magenta
  "160, 130, 0", // Dark yellow
  "20, 140, 60", // Forest green
  "180, 80, 0", // Dark orange
  "120, 0, 200", // Deep purple
];

export type SportColorMap = Map<string, string>;

/**
 * Build a color map assigning maximally-contrasting colors to sports.
 * Sports should be passed in display order (e.g. sorted by route count desc).
 */
export function buildSportColorMap(sports: string[], isDark: boolean): SportColorMap {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  const map = new Map<string, string>();
  for (let i = 0; i < sports.length; i++) {
    const sport = sports[i];
    const color = palette[i % palette.length];
    if (sport !== undefined && color !== undefined) map.set(sport, color);
  }
  return map;
}

const CANVAS_PADDING = 40;
/** Routes above this count get lower opacity to avoid blowing out with additive blending */
const HIGH_DENSITY_THRESHOLD = 200;

const DARK_HIGH_DENSITY_ALPHA = 0.05;
const DARK_LOW_DENSITY_ALPHA = 0.08;
const LIGHT_HIGH_DENSITY_ALPHA = 0.25;
const LIGHT_LOW_DENSITY_ALPHA = 0.35;

export interface RouteCanvasHandle {
  getCanvas: () => HTMLCanvasElement | null;
}

interface RouteCanvasProps {
  routes: NormalizedRoute[];
  sportColors: SportColorMap;
  rings?: RouteRing[] | undefined;
  /** Label formatter for ring distances, e.g. "10 mi" or "20 km" */
  formatRingLabel?: ((radiusMeters: number) => string) | undefined;
  className?: string | undefined;
}

const RouteCanvas = forwardRef<RouteCanvasHandle, RouteCanvasProps>(function RouteCanvas(
  { routes, sportColors, rings, formatRingLabel, className = "" },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
  }));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const hasRoutes = routes.length > 0;
    const hasRings = rings && rings.length > 0;
    if (!canvas || (!hasRoutes && !hasRings)) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle retina displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = CANVAS_PADDING;

    // Compute bounding box across all routes and rings
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const route of routes) {
      for (const coord of route.coords) {
        const [x, y] = coord;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    // Include ring coords in bounding box (ensures rings are visible, especially when routes are empty)
    if (hasRings) {
      for (const ring of rings) {
        for (const coord of ring.coords) {
          const [x, y] = coord;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const dataWidth = maxX - minX || 1;
    const dataHeight = maxY - minY || 1;

    // Scale uniformly to fit canvas with padding
    const scaleX = (width - 2 * padding) / dataWidth;
    const scaleY = (height - 2 * padding) / dataHeight;
    const scale = Math.min(scaleX, scaleY);

    const centerX = width / 2;
    const centerY = height / 2;
    const dataCenterX = (minX + maxX) / 2;
    const dataCenterY = (minY + maxY) / 2;

    // Project a coordinate to canvas space
    // Note: y is flipped because canvas y increases downward but geo latitude increases upward
    const projectX = (x: number) => centerX + (x - dataCenterX) * scale;
    const projectY = (y: number) => centerY - (y - dataCenterY) * scale;

    // Fill background with theme-appropriate color
    ctx.fillStyle =
      getComputedStyle(canvas).getPropertyValue("--color-bg-body").trim() ||
      (isDark ? "#0f1724" : "#f0f4f8");
    ctx.fillRect(0, 0, width, height);

    // Draw distance rings (before routes so they appear behind)
    if (hasRings) {
      // Slightly more visible when rings are the only element on screen
      const ringAlpha = hasRoutes ? (isDark ? 0.15 : 0.12) : isDark ? 0.25 : 0.2;

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = isDark
        ? `rgba(255, 255, 255, ${ringAlpha})`
        : `rgba(0, 0, 0, ${ringAlpha})`;

      for (const ring of rings) {
        const first = ring.coords[0];
        if (!first) continue;

        ctx.beginPath();
        ctx.moveTo(projectX(first[0]), projectY(first[1]));
        for (let i = 1; i < ring.coords.length; i++) {
          const coord = ring.coords[i];
          if (!coord) continue;
          ctx.lineTo(projectX(coord[0]), projectY(coord[1]));
        }
        ctx.closePath();
        ctx.stroke();

        // Draw distance label at the top of the ring
        if (formatRingLabel) {
          // Find the topmost point (highest projected Y = lowest canvas Y)
          let topCoord = first;
          let topY = Infinity;
          for (const coord of ring.coords) {
            const py = projectY(coord[1]);
            if (py < topY) {
              topY = py;
              topCoord = coord;
            }
          }

          const labelX = projectX(topCoord[0]);
          const labelY = topY;

          ctx.save();
          ctx.setLineDash([]);
          ctx.font = "10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.35)" : "rgba(0, 0, 0, 0.3)";
          ctx.fillText(formatRingLabel(ring.radiusMeters), labelX, labelY - 4);
          ctx.restore();
        }
      }

      ctx.restore();
    }

    // Dark: additive blending for neon glow; Light: standard blending for saturated strokes
    ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";

    const isHighDensity = routes.length > HIGH_DENSITY_THRESHOLD;
    const [highAlpha, lowAlpha] = isDark
      ? [DARK_HIGH_DENSITY_ALPHA, DARK_LOW_DENSITY_ALPHA]
      : [LIGHT_HIGH_DENSITY_ALPHA, LIGHT_LOW_DENSITY_ALPHA];
    const alpha = isHighDensity ? highAlpha : lowAlpha;

    // Fallback color for sports not in the map (shouldn't happen normally)
    const fallbackRgb = isDark ? "255, 255, 255" : "100, 100, 100";

    for (const route of routes) {
      const first = route.coords[0];
      if (!first) continue;

      const rgb = sportColors.get(route.sport) ?? fallbackRgb;
      ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(projectX(first[0]), projectY(first[1]));

      for (let i = 1; i < route.coords.length; i++) {
        const coord = route.coords[i];
        if (!coord) continue;
        ctx.lineTo(projectX(coord[0]), projectY(coord[1]));
      }

      ctx.stroke();
    }
  }, [routes, sportColors, rings, formatRingLabel, isDark]);

  // Draw on data/theme change
  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on container resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
});

export default RouteCanvas;

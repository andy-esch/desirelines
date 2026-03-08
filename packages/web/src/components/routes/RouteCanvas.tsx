import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { NormalizedRoute } from "../../api/routes";
import { useTheme } from "../../contexts/ThemeContext";

/** Dark mode: neon palette with additive blending */
export const DARK_SPORT_COLORS: Record<string, string> = {
  cycling: "0, 255, 255",
  running: "0, 255, 128",
  swimming: "180, 0, 255",
  walking: "255, 200, 0",
  hiking: "255, 128, 0",
};
const DARK_DEFAULT_COLOR = "255, 0, 255";

/** Light mode: darker saturated colors with standard blending */
export const LIGHT_SPORT_COLORS: Record<string, string> = {
  cycling: "0, 120, 200",
  running: "20, 140, 60",
  swimming: "120, 0, 200",
  walking: "180, 140, 0",
  hiking: "180, 80, 0",
};
const LIGHT_DEFAULT_COLOR = "160, 0, 140";

const CANVAS_PADDING = 40;
/** Routes above this count get lower opacity to avoid blowing out with additive blending */
const HIGH_DENSITY_THRESHOLD = 200;

const DARK_HIGH_DENSITY_ALPHA = 0.05;
const DARK_LOW_DENSITY_ALPHA = 0.08;
const LIGHT_HIGH_DENSITY_ALPHA = 0.25;
const LIGHT_LOW_DENSITY_ALPHA = 0.35;

export function getColorForSport(sport: string, isDark: boolean): string {
  if (isDark) {
    return DARK_SPORT_COLORS[sport] ?? DARK_DEFAULT_COLOR;
  }
  return LIGHT_SPORT_COLORS[sport] ?? LIGHT_DEFAULT_COLOR;
}

export interface RouteCanvasHandle {
  getCanvas: () => HTMLCanvasElement | null;
}

interface RouteCanvasProps {
  routes: NormalizedRoute[];
  className?: string;
}

const RouteCanvas = forwardRef<RouteCanvasHandle, RouteCanvasProps>(function RouteCanvas(
  { routes, className = "" },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || routes.length === 0) return;

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

    // Compute bounding box across all routes
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
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--color-bg-body");
    ctx.fillRect(0, 0, width, height);

    // Dark: additive blending for neon glow; Light: standard blending for saturated strokes
    ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";

    const alpha =
      routes.length > HIGH_DENSITY_THRESHOLD
        ? isDark
          ? DARK_HIGH_DENSITY_ALPHA
          : LIGHT_HIGH_DENSITY_ALPHA
        : isDark
          ? DARK_LOW_DENSITY_ALPHA
          : LIGHT_LOW_DENSITY_ALPHA;

    for (const route of routes) {
      if (route.coords.length < 2) continue;

      const rgb = getColorForSport(route.sport, isDark);
      ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(projectX(route.coords[0][0]), projectY(route.coords[0][1]));

      for (let i = 1; i < route.coords.length; i++) {
        ctx.lineTo(projectX(route.coords[i][0]), projectY(route.coords[i][1]));
      }

      ctx.stroke();
    }
  }, [routes, isDark]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
});

export default RouteCanvas;

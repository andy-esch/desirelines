import { useEffect, useRef } from "react";
import type { NormalizedRoute } from "../../api/routes";

/** Neon color palette keyed by sport category */
const SPORT_COLORS: Record<string, string> = {
  cycling: "0, 255, 255",
  running: "0, 255, 128",
  swimming: "180, 0, 255",
};
const DEFAULT_COLOR = "255, 0, 255";

const CANVAS_PADDING = 40;
/** Routes above this count get lower opacity to avoid blowing out with additive blending */
const HIGH_DENSITY_THRESHOLD = 200;
const HIGH_DENSITY_ALPHA = 0.05;
const LOW_DENSITY_ALPHA = 0.08;

function getColorForSport(sport: string): string {
  return SPORT_COLORS[sport] ?? DEFAULT_COLOR;
}

interface RouteCanvasProps {
  routes: NormalizedRoute[];
  className?: string;
}

export default function RouteCanvas({ routes, className = "" }: RouteCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    // Fill dark background
    ctx.fillStyle = "#0f1724";
    ctx.fillRect(0, 0, width, height);

    // Additive blending for glow effect
    ctx.globalCompositeOperation = "lighter";

    const alpha = routes.length > HIGH_DENSITY_THRESHOLD ? HIGH_DENSITY_ALPHA : LOW_DENSITY_ALPHA;

    for (const route of routes) {
      if (route.coords.length < 2) continue;

      const rgb = getColorForSport(route.sport);
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
  }, [routes]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

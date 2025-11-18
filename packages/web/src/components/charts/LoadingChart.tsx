import { useRef, useEffect, useState } from "react";
import { selectRandomAnimation } from "./animations/registry";
import type { LoadingAnimation } from "./animations/types";
import { CHART_CONFIG } from "../../constants/chartConfig";

/**
 * Loading chart with generative art animations
 *
 * Displays a random NEON-themed animation while data is loading.
 * Supports prefers-reduced-motion for accessibility.
 *
 * To add new animations:
 * 1. Create animation class implementing LoadingAnimation interface
 * 2. Add to ANIMATION_REGISTRY in ./animations/registry.ts
 * 3. That's it! No changes needed here.
 */
export default function LoadingChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const animationInstanceRef = useRef<LoadingAnimation | null>(null);
  const startTimeRef = useRef<number>(0);

  // Check for reduced motion preference
  const [prefersReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    // If user prefers reduced motion, skip animation
    if (prefersReducedMotion) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match chart dimensions
    // Use responsive width, but match chart's configured height
    const width = canvas.parentElement?.clientWidth || 400;
    const height = CHART_CONFIG.height;
    canvas.width = width;
    canvas.height = height;

    // Select random animation from registry
    const animation = selectRandomAnimation();
    animationInstanceRef.current = animation;

    // Initialize animation
    animation.initialize({ width, height });

    // Store start time
    startTimeRef.current = performance.now();

    // Clear canvas once at start (for accumulating animations)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Animation loop
    const animate = (timestamp: number) => {
      if (!ctx || !canvas) return;

      const elapsed = timestamp - startTimeRef.current;

      // Only clear canvas if animation requests it (default: true)
      if (animation.clearCanvas !== false) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }

      // Render animation frame
      animation.render({
        ctx,
        dimensions: { width, height },
        timestamp,
        elapsed,
      });

      // Continue animation loop
      animationRef.current = requestAnimationFrame(animate);
    };

    // Start animation
    animationRef.current = requestAnimationFrame(animate);

    // Cleanup on unmount
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (animationInstanceRef.current?.cleanup) {
        animationInstanceRef.current.cleanup();
      }
    };
  }, [prefersReducedMotion]);

  // Fallback for reduced motion preference
  if (prefersReducedMotion) {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ minHeight: "300px" }}
      >
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="d-flex justify-content-center align-items-center"
      style={{ minHeight: `${CHART_CONFIG.height}px` }}
      role="status"
      aria-label="Loading chart data"
    >
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: "100%",
          height: "auto",
        }}
      />
      <span className="visually-hidden">Loading...</span>
    </div>
  );
}

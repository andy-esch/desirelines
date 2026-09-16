interface LogoProps {
  /** Overrides the theme's `--wordmark-size`, e.g. a smaller header logo. */
  fontSize?: string;
  /** Overrides the theme's `--wordmark-weight`. */
  fontWeight?: number;
  /** Overrides the theme's `--wordmark-tracking`. */
  letterSpacing?: string;
}

/**
 * The desire/lines wordmark. Face, size, case, colors and glow come from the theme's
 * `--wordmark-*` slots; the props only override size, weight and tracking for one placement.
 */
export default function Logo({ fontSize, fontWeight, letterSpacing }: LogoProps) {
  return (
    <span
      style={{
        fontFamily: "var(--wordmark-font)",
        fontSize: fontSize ?? "var(--wordmark-size)",
        fontWeight: fontWeight ?? "var(--wordmark-weight)",
        letterSpacing: letterSpacing ?? "var(--wordmark-tracking)",
        textTransform: "var(--wordmark-case)" as React.CSSProperties["textTransform"],
        textShadow: "var(--wordmark-shadow)",
        userSelect: "none",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "baseline",
      }}
    >
      <span style={{ color: "var(--wordmark-color)" }}>desire</span>
      <span
        style={{
          color: "var(--wordmark-slash-color)",
          fontSize: "var(--wordmark-slash-size)",
          fontWeight: "var(--wordmark-slash-weight)",
        }}
      >
        /
      </span>
      <span style={{ color: "var(--wordmark-color-2)" }}>lines</span>
    </span>
  );
}

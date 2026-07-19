interface LogoProps {
  fontSize?: string;
  fontWeight?: number;
  letterSpacing?: string;
}

export default function Logo({
  fontSize = "1.5rem",
  fontWeight = 600,
  letterSpacing = "0.15em",
}: LogoProps) {
  return (
    <span
      style={{
        fontSize,
        fontWeight,
        letterSpacing,
        userSelect: "none",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "baseline",
      }}
    >
      <span style={{ color: "color-mix(in srgb, var(--color-neon-cyan) 70%, transparent)" }}>
        desire
      </span>
      <span
        style={{
          color: "color-mix(in srgb, var(--color-neon-yellow-pure) 90%, transparent)",
          fontSize: "1.2em",
          fontWeight: 400,
        }}
      >
        /
      </span>
      <span style={{ color: "color-mix(in srgb, var(--color-neon-magenta) 70%, transparent)" }}>
        lines
      </span>
    </span>
  );
}

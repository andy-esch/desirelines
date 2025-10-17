interface LogoProps {
  fontSize?: string;
  fontWeight?: number;
  letterSpacing?: string;
}

export default function Logo({
  fontSize = '1.5rem',
  fontWeight = 600,
  letterSpacing = '0.15em'
}: LogoProps) {
  return (
    <span style={{ fontSize, fontWeight, letterSpacing }}>
      <span style={{ color: 'rgba(0, 255, 255, 0.7)' }}>desire</span>
      <span style={{ color: 'rgba(255, 255, 0, 0.9)', fontSize: '1.2em', fontWeight: 400 }}>/</span>
      <span style={{ color: 'rgba(255, 0, 255, 0.7)' }}>ines</span>
    </span>
  );
}

/**
 * Bootstrap "geo-alt" map-pin glyph — the shared symbol for "view this on the map"
 * deep links (e.g. the activity lists' link into the routes map), so the affordance
 * reads consistently wherever it appears. Mirrors `ExternalLinkIcon`'s tiny-inline-SVG
 * shape (currentColor fill, aria-hidden).
 */
export function MapPinIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="currentColor"
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
    </svg>
  );
}

/**
 * The mark for a value that isn't there: no distance for a yoga session, no pace this
 * early in the year, no prior-year point on a date. One glyph everywhere, an em dash, in
 * the theme's `--missing-value-color`; a theme that leaves that slot `initial` keeps the
 * surrounding text's color. Screen readers hear "none" rather than a dash.
 *
 * A value still loading is not missing: it keeps its loading placeholder.
 */
export function MissingValue() {
  return (
    <span className="text-[color:var(--missing-value-color,currentColor)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">none</span>
    </span>
  );
}

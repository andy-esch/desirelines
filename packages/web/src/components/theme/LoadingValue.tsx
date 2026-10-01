/**
 * The mark for a value still loading: an ellipsis in the surrounding text's color, and
 * "loading" to a screen reader. The value replaces it once it arrives; a value that turns
 * out not to be there becomes a `MissingValue`.
 */
export function LoadingValue() {
  return (
    <span>
      <span aria-hidden="true">…</span>
      <span className="sr-only">loading</span>
    </span>
  );
}

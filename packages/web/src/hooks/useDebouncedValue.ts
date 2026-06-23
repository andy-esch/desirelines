import { useEffect, useState } from "react";

/**
 * Returns `value` after it has been stable for `ms` (trailing debounce). Used to
 * keep an `aria-live` region from flooding screen readers during continuous input
 * (e.g. a slider drag): the announced string updates only once the user pauses.
 */
export function useDebouncedValue<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

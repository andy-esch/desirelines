import { createContext, useContext } from "react";

/** A heading level below the page's `h1`. */
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

/** Raised by `NextHeadingLevel` inside each titled `Section` and `Panel`. */
export const HeadingLevelContext = createContext<HeadingLevel>(2);

/**
 * The level for a heading rendered here: `h2` at the top of a page, one deeper inside each
 * titled `Section` or `Panel`. A panel under a section's heading is then an `h3`, and one
 * straight under the page title an `h2`, so the outline never skips a level.
 */
export function useHeadingLevel(): HeadingLevel {
  return useContext(HeadingLevelContext);
}

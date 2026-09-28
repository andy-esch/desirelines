import type { ReactNode } from "react";
import { HeadingLevelContext, useHeadingLevel, type HeadingLevel } from "./useHeadingLevel";

/** Headings inside `children` sit one level below this one (`h6` at most). */
export function NextHeadingLevel({ children }: { children: ReactNode }) {
  const level = useHeadingLevel();
  const next = Math.min(level + 1, 6) as HeadingLevel;
  return <HeadingLevelContext.Provider value={next}>{children}</HeadingLevelContext.Provider>;
}

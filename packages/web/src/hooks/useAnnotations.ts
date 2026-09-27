import type { AnnotationsForYear } from "../services/userConfigService";
import { useConfigSection } from "./useConfigSection";

const NONE: AnnotationsForYear = { annotations: [] };

/**
 * One year's annotations: the account's, or the demo's on this device. `annotations` is
 * always set, empty where nothing is saved (`isSaved` says which).
 */
export function useAnnotations(year: number) {
  const { value, ...section } = useConfigSection<AnnotationsForYear>({
    section: "annotations",
    year,
  });
  return { ...section, annotations: value ?? NONE };
}

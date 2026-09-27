import type {
  AnnotationsForYear,
  GoalsForYear,
  Preferences,
  UserConfig,
} from "../userConfigService";

/**
 * The sections of a user's config document, each saved on its own: the preferences, one
 * year's goals for one sport, and one year's annotations. The store holds the whole
 * document; a section is a view of it.
 */
export type PreferencesRef = { section: "preferences" };
export type GoalsRef = { section: "goals"; year: number; sport: string };
export type AnnotationsRef = { section: "annotations"; year: number };
export type SectionRef = PreferencesRef | GoalsRef | AnnotationsRef;

export type ConfigSection = GoalsForYear | AnnotationsForYear | Preferences;

/** A document with nothing in it, for a first save to go into. */
function emptyConfig(): UserConfig {
  return { schemaVersion: "", userId: "", lastUpdated: "", goals: {}, annotations: {} };
}

/** The section as saved, or null when nothing is. */
export function selectSection(
  doc: UserConfig | null | undefined,
  ref: GoalsRef
): GoalsForYear | null;
export function selectSection(
  doc: UserConfig | null | undefined,
  ref: AnnotationsRef
): AnnotationsForYear | null;
export function selectSection(
  doc: UserConfig | null | undefined,
  ref: PreferencesRef
): Preferences | null;
export function selectSection(
  doc: UserConfig | null | undefined,
  ref: SectionRef
): ConfigSection | null;
export function selectSection(
  doc: UserConfig | null | undefined,
  ref: SectionRef
): ConfigSection | null {
  if (!doc) return null;
  switch (ref.section) {
    case "preferences":
      return doc.preferences ?? null;
    case "goals":
      return doc.goals?.[String(ref.year)]?.sports?.[ref.sport] ?? null;
    case "annotations":
      return doc.annotations?.[String(ref.year)] ?? null;
  }
}

/** `record` without `key`, leaving the original alone. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/**
 * A copy of the document with one section set to `value`, or taken out when `value` is
 * null. Every other section is left as it was: an optimistic save and its rollback touch
 * only the section being saved, so they can't undo a save of another section in between.
 */
export function withSection(
  doc: UserConfig | null | undefined,
  ref: SectionRef,
  value: ConfigSection | null
): UserConfig {
  const base = doc ?? emptyConfig();
  switch (ref.section) {
    case "preferences": {
      const { preferences: _previous, ...rest } = base;
      return value === null ? rest : { ...rest, preferences: value as Preferences };
    }
    case "goals": {
      const year = String(ref.year);
      const sports = base.goals?.[year]?.sports ?? {};
      return {
        ...base,
        goals: {
          ...base.goals,
          [year]: {
            ...base.goals?.[year],
            sports:
              value === null
                ? without(sports, ref.sport)
                : { ...sports, [ref.sport]: value as GoalsForYear },
          },
        },
      };
    }
    case "annotations": {
      const year = String(ref.year);
      const annotations = base.annotations ?? {};
      return {
        ...base,
        annotations:
          value === null
            ? without(annotations, year)
            : { ...annotations, [year]: value as AnnotationsForYear },
      };
    }
  }
}

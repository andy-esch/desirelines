import {
  UserConfigService,
  type AnnotationsForYear,
  type GoalsForYear,
  type Preferences,
  type UserConfig,
} from "../userConfigService";
import type { AuthService } from "../auth/AuthService";
import type { DatabaseService } from "../database/DatabaseService";
import { configQueryKey, type ConfigAdapter } from "./configAdapter";
import type { ConfigSection, SectionRef } from "./sections";

/**
 * The signed-in account's config: its Firestore document, read through one listener.
 *
 * `load` answers from that listener rather than reading the document again: a separate
 * read could land after a newer snapshot and put an older copy in the cache, which nothing
 * would correct until the next change. So `load` waits for the first snapshot, and later
 * calls get the latest one. Saves write one section, with no read (`updateConfigSection`).
 */
class FirestoreConfigAdapter implements ConfigAdapter {
  readonly kind = "account" as const;
  readonly queryKey: readonly unknown[];
  private readonly service: UserConfigService;
  private latest: { doc: UserConfig | null } | null = null;
  private failure: Error | null = null;
  private waiting: { resolve: (doc: UserConfig | null) => void; reject: (e: Error) => void }[] = [];

  constructor(
    uid: string,
    services: { authService: AuthService; databaseService: DatabaseService }
  ) {
    this.queryKey = configQueryKey(uid);
    this.service = new UserConfigService(undefined, "v1", services);
  }

  load(): Promise<UserConfig | null> {
    if (this.latest) return Promise.resolve(this.latest.doc);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  subscribe(
    onChange: (doc: UserConfig | null) => void,
    onError: (error: Error) => void
  ): () => void {
    return this.service.subscribeToConfig(
      (doc) => {
        this.latest = { doc };
        this.failure = null;
        for (const { resolve } of this.waiting.splice(0)) resolve(doc);
        onChange(doc);
      },
      (error) => {
        // Before any snapshot there's no copy to keep, so the load fails with it.
        if (!this.latest) {
          this.failure = error;
          for (const { reject } of this.waiting.splice(0)) reject(error);
        }
        onError(error);
      }
    );
  }

  saveSection(ref: SectionRef, value: ConfigSection): Promise<void> {
    switch (ref.section) {
      case "goals":
        return this.service.updateConfigSection(
          "goals",
          value as GoalsForYear,
          ref.year,
          ref.sport
        );
      case "annotations":
        return this.service.updateConfigSection(
          "annotations",
          value as AnnotationsForYear,
          ref.year
        );
      case "preferences":
        return this.service.updateConfigSection("preferences", value as Preferences);
    }
  }
}

export function createFirestoreAdapter(
  uid: string,
  services: { authService: AuthService; databaseService: DatabaseService }
): ConfigAdapter {
  return new FirestoreConfigAdapter(uid, services);
}

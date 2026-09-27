import type { UserConfig } from "../userConfigService";
import type { ConfigSection, SectionRef } from "./sections";

/**
 * Where a session's user config lives: the signed-in account's Firestore document, or the
 * demo's own storage on this device. The two never read each other. Either way the store
 * gets one document and saves one section at a time.
 */
export interface ConfigAdapter {
  readonly kind: "account" | "demo";
  /** The store's cache entry for this session: one entry, for the whole document. */
  readonly queryKey: readonly unknown[];
  /** The document as saved, or null when nothing is. */
  load(): Promise<UserConfig | null>;
  /**
   * The document as it changes, for as long as the returned function isn't called.
   * `onError` reports a listener that failed or a document that didn't validate: neither
   * is an empty document, so the store keeps its last good copy. The demo has no other
   * writer, so it has no listener.
   */
  subscribe?(
    onChange: (doc: UserConfig | null) => void,
    onError: (error: Error) => void
  ): () => void;
  /** Save one section, leaving the rest of the document as saved. */
  saveSection(ref: SectionRef, value: ConfigSection): Promise<void>;
}

/** The cache key for a session's document: the account's uid, or the demo. */
export function configQueryKey(session: string): readonly unknown[] {
  return ["userConfig", session, "v1"];
}

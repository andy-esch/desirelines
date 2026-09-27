import { parseConfigData, type UserConfig } from "../userConfigService";
import { parseDemoConfigKey, readDemoSection, saveDemoSection } from "../demoStorage";
import { logApiError } from "../../api/errors";
import { configQueryKey, type ConfigAdapter } from "./configAdapter";
import { withSection, type ConfigSection, type SectionRef } from "./sections";

/**
 * The demo's saved sections, gathered into one document. Each is validated against its
 * section's schema: one that fails, or isn't JSON, is logged and left out, as if nothing
 * were saved there. Null when nothing valid is saved, or storage can't be read.
 */
function readDemoConfig(): UserConfig | null {
  let doc: UserConfig | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const ref = key === null ? null : parseDemoConfigKey(key);
      if (!ref) continue;
      const stored = readDemoSection(
        ref.section,
        "year" in ref ? ref.year : undefined,
        "sport" in ref ? ref.sport : undefined
      );
      if (stored === null) continue;
      const section = parseDemoSection(ref, stored);
      if (section) doc = withSection(doc, ref, section);
    }
  } catch (err) {
    logApiError(err, "[demo config] storage can't be read; showing defaults");
    return null;
  }
  return doc;
}

function parseDemoSection(ref: SectionRef, stored: string): ConfigSection | null {
  try {
    const result = parseConfigData(ref.section, JSON.parse(stored) as unknown);
    if (result.ok) return result.data;
    logApiError(result.error, `[demo config] ${ref.section} failed schema validation; ignored`);
  } catch (err) {
    logApiError(err, `[demo config] ${ref.section} isn't valid JSON; ignored`);
  }
  return null;
}

/**
 * The demo's config: what a signed-out visitor saves, in this device's storage under the
 * demo's own keys (`services/demoStorage.ts`). The account's never reads these, and this
 * never reads the account's. Nothing else writes them while the page is open, so there's no
 * listener: a save updates the store's copy directly.
 */
class DemoConfigAdapter implements ConfigAdapter {
  readonly kind = "demo" as const;
  readonly queryKey = configQueryKey("demo");

  load(): Promise<UserConfig | null> {
    return Promise.resolve(readDemoConfig());
  }

  saveSection(ref: SectionRef, value: ConfigSection): Promise<void> {
    try {
      saveDemoSection(
        ref.section,
        value,
        "year" in ref ? ref.year : undefined,
        "sport" in ref ? ref.sport : undefined
      );
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export function createDemoAdapter(): ConfigAdapter {
  return new DemoConfigAdapter();
}

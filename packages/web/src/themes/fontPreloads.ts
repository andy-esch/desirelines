// The web faces a theme can name, by family. Vite rewrites each `?url` import to the
// hashed file it emits, so the preload points at the same file the stylesheet requests.
import archivoBlack from "@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2?url";
import michroma from "@fontsource/michroma/files/michroma-latin-400-normal.woff2?url";
import plexMono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
import plexMono500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url";
import plexMono600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url";
import { getTheme, isThemeId, type ThemeFont } from "./registry";

/**
 * Latin files per family and weight. Only the faces a theme lists are preloaded, and only
 * the weights it names, so a theme never pays for another's faces. Families absent here
 * (the system stack, and Space Grotesk, which ships as one variable file already imported
 * by the stylesheet) simply have nothing to preload.
 */
const FONT_FILES: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  "IBM Plex Mono": { 400: plexMono400, 500: plexMono500, 600: plexMono600 },
  "Archivo Black": { 400: archivoBlack },
  Michroma: { 400: michroma },
};

function filesFor(fonts: readonly ThemeFont[]): string[] {
  return fonts.flatMap((font) =>
    font.weights.map((weight) => FONT_FILES[font.family]?.[weight]).filter((url) => url != null)
  );
}

/**
 * Preload the display and body faces of the theme the first-paint script applied, so a
 * headline doesn't paint in the fallback face first. Called before the app renders; the
 * stylesheet's own `@font-face` rules would otherwise only reach the browser after the CSS
 * parses. Preloading every weight the theme names is a few files, all of which the page
 * goes on to use.
 */
export function preloadThemeFonts(document: Document): void {
  const id = document.documentElement.dataset.theme;
  if (!isThemeId(id)) return;
  for (const href of filesFor(getTheme(id).fonts)) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "font";
    link.type = "font/woff2";
    link.crossOrigin = "anonymous";
    link.href = href;
    document.head.appendChild(link);
  }
}

import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";
import type { MapPalette, ThemeMap } from "../../themes/registry";

/** The parts of a style layer the recolor reads. */
export interface BaseMapLayer {
  readonly id: string;
  readonly type: string;
  readonly "source-layer"?: string | undefined;
}

export type BaseMapRole =
  | "land"
  | "park"
  | "water"
  | "building"
  | "admin"
  | "tunnel"
  | "roadByClass"
  | "roadMinor"
  | "label"
  | "labelStrong";

/**
 * The palette role a layer takes, or `null` to leave it alone. Grouped by the Mapbox
 * Streets data layer (`source-layer`) rather than by layer id, so a layer a Mapbox style
 * update adds to a known data layer is recolored too, and one from an unknown data layer
 * keeps its stock color instead of taking a wrong one.
 */
export function baseMapRole(layer: BaseMapLayer): BaseMapRole | null {
  const sourceLayer = layer["source-layer"] ?? "";
  if (layer.type === "background") return "land";
  if (sourceLayer === "water" || sourceLayer === "waterway") return "water";
  if (sourceLayer === "landuse" || sourceLayer === "landuse_overlay") return "park";
  if (sourceLayer === "building" || sourceLayer === "structure" || sourceLayer === "aeroway") {
    return "building";
  }
  if (sourceLayer === "admin") return "admin";
  if (sourceLayer === "road") {
    if (layer.type === "symbol") return "label";
    if (layer.id.startsWith("tunnel")) return "tunnel";
    // The "simple" layers draw streets and highways, with the road class in the data.
    return layer.id.includes("simple") ? "roadByClass" : "roadMinor";
  }
  if (layer.type === "symbol") {
    return /settlement|state|country/.test(layer.id) ? "labelStrong" : "label";
  }
  return null;
}

/** A paint or layout change the recolor makes to one layer. */
export type StyleWrite =
  | {
      readonly layerId: string;
      readonly kind: "paint";
      readonly property: "background-color" | "fill-color" | "line-color" | "text-color";
      readonly value: string | ExpressionSpecification;
    }
  | {
      readonly layerId: string;
      readonly kind: "paint";
      readonly property: "text-halo-color";
      readonly value: string;
    }
  | {
      readonly layerId: string;
      readonly kind: "layout";
      readonly property: "text-font";
      readonly value: string[];
    };

const COLOR_PROPERTY = {
  background: "background-color",
  fill: "fill-color",
  line: "line-color",
  symbol: "text-color",
} as const;

function roleColor(role: BaseMapRole, palette: MapPalette): string | ExpressionSpecification {
  if (role === "roadByClass") {
    return [
      "match",
      ["get", "class"],
      ["motorway", "trunk"],
      palette.roadMotorway,
      ["primary", "secondary"],
      palette.roadPrimary,
      palette.roadMinor,
    ];
  }
  return palette[role];
}

/** The writes that apply a theme's map colors and label font to a style's layers. */
export function baseMapWrites(layers: readonly BaseMapLayer[], baseMap: ThemeMap): StyleWrite[] {
  const { palette, labelFont } = baseMap;
  const writes: StyleWrite[] = [];
  for (const layer of layers) {
    if (palette) {
      const role = baseMapRole(layer);
      const property = COLOR_PROPERTY[layer.type as keyof typeof COLOR_PROPERTY] as
        (typeof COLOR_PROPERTY)[keyof typeof COLOR_PROPERTY] | undefined;
      if (role && property) {
        writes.push({
          layerId: layer.id,
          kind: "paint",
          property,
          value: roleColor(role, palette),
        });
        if (layer.type === "symbol") {
          writes.push({
            layerId: layer.id,
            kind: "paint",
            property: "text-halo-color",
            value: palette.labelHalo,
          });
        }
      }
    }
    if (labelFont && layer.type === "symbol") {
      writes.push({
        layerId: layer.id,
        kind: "layout",
        property: "text-font",
        // Arial Unicode MS covers scripts the label font lacks.
        value: [labelFont, "Arial Unicode MS Regular"],
      });
    }
  }
  return writes;
}

/**
 * Apply a theme's map colors and label font to a freshly loaded style. Writes on top of
 * whatever the style holds, so call it right after a style load: switching back to a
 * theme with `null` fields needs a style reload, not a second call.
 */
export function applyBaseMap(
  map: Pick<MapboxMap, "getStyle" | "setPaintProperty" | "setLayoutProperty">,
  baseMap: ThemeMap
): void {
  if (!baseMap.palette && !baseMap.labelFont) return;
  for (const write of baseMapWrites(map.getStyle().layers ?? [], baseMap)) {
    if (write.kind === "layout") {
      map.setLayoutProperty(write.layerId, write.property, write.value);
    } else {
      map.setPaintProperty(write.layerId, write.property, write.value);
    }
  }
}

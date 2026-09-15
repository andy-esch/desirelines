import { describe, it, expect, vi } from "vitest";
import { applyBaseMap, baseMapRole, baseMapWrites, type BaseMapRole } from "./mapRecolor";
import { MAPBOX_DARK_V11_LAYERS } from "../../test/fixtures/mapboxDarkV11Layers";
import { RETRO_BASE_MAPS } from "../../themes/baseMaps";

const MIAMI = RETRO_BASE_MAPS.miami;

describe("baseMapRole", () => {
  it("gives every dark-v11 layer the expected role", () => {
    const byRole: Record<string, string[]> = {};
    for (const layer of MAPBOX_DARK_V11_LAYERS) {
      const role = baseMapRole(layer) ?? "none";
      (byRole[role] ??= []).push(layer.id);
    }

    expect(byRole).toEqual({
      land: ["land"],
      park: ["national-park", "landuse"],
      water: ["waterway", "water"],
      building: [
        "land-structure-polygon",
        "land-structure-line",
        "aeroway-polygon",
        "aeroway-line",
        "building",
      ],
      tunnel: [
        "tunnel-path-trail",
        "tunnel-path-cycleway-piste",
        "tunnel-path",
        "tunnel-steps",
        "tunnel-pedestrian",
        "tunnel-simple",
      ],
      roadMinor: [
        "road-path-trail",
        "road-path-cycleway-piste",
        "road-path",
        "road-steps",
        "road-pedestrian",
        "road-rail",
        "bridge-path-trail",
        "bridge-path-cycleway-piste",
        "bridge-path",
        "bridge-steps",
        "bridge-pedestrian",
        "bridge-rail",
      ],
      roadByClass: ["road-simple", "bridge-case-simple", "bridge-simple"],
      admin: [
        "admin-1-boundary-bg",
        "admin-0-boundary-bg",
        "admin-1-boundary",
        "admin-0-boundary",
        "admin-0-boundary-disputed",
      ],
      label: [
        "road-label-simple",
        "waterway-label",
        "natural-line-label",
        "natural-point-label",
        "water-line-label",
        "water-point-label",
        "poi-label",
        "airport-label",
        "continent-label",
      ],
      labelStrong: [
        "settlement-subdivision-label",
        "settlement-minor-label",
        "settlement-major-label",
        "state-label",
        "country-label",
      ],
    } satisfies Partial<Record<BaseMapRole | "none", string[]>>);
  });

  it("leaves a layer from a data layer it doesn't know alone", () => {
    expect(baseMapRole({ id: "hillshade", type: "hillshade", "source-layer": "hillshade" })).toBe(
      null
    );
  });
});

describe("baseMapWrites", () => {
  it("writes one color per fill, line and background layer and two per label for dark-v11", () => {
    const writes = baseMapWrites(MAPBOX_DARK_V11_LAYERS, MIAMI);
    expect(writes.filter((w) => w.kind === "paint")).toHaveLength(64);
    expect(writes.filter((w) => w.kind === "layout")).toHaveLength(14);
  });

  it("colors streets by road class", () => {
    const [write] = baseMapWrites(
      [{ id: "road-simple", type: "line", "source-layer": "road" }],
      MIAMI
    );
    expect(write).toEqual({
      layerId: "road-simple",
      kind: "paint",
      property: "line-color",
      value: [
        "match",
        ["get", "class"],
        ["motorway", "trunk"],
        MIAMI.palette.roadMotorway,
        ["primary", "secondary"],
        MIAMI.palette.roadPrimary,
        MIAMI.palette.roadMinor,
      ],
    });
  });

  it("sets label color, halo and font on symbol layers", () => {
    const writes = baseMapWrites(
      [{ id: "poi-label", type: "symbol", "source-layer": "poi_label" }],
      MIAMI
    );
    expect(writes).toEqual([
      { layerId: "poi-label", kind: "paint", property: "text-color", value: MIAMI.palette.label },
      {
        layerId: "poi-label",
        kind: "paint",
        property: "text-halo-color",
        value: MIAMI.palette.labelHalo,
      },
      {
        layerId: "poi-label",
        kind: "layout",
        property: "text-font",
        value: ["Roboto Mono Regular", "Arial Unicode MS Regular"],
      },
    ]);
  });

  it("skips layer types it has no color property for", () => {
    expect(
      baseMapWrites(
        [{ id: "building-3d", type: "fill-extrusion", "source-layer": "building" }],
        MIAMI
      )
    ).toEqual([]);
  });

  it("writes nothing for the stock map, and each half on its own", () => {
    expect(baseMapWrites(MAPBOX_DARK_V11_LAYERS, { palette: null, labelFont: null })).toEqual([]);

    const fontOnly = baseMapWrites(MAPBOX_DARK_V11_LAYERS, { palette: null, labelFont: "X" });
    expect(fontOnly.every((w) => w.kind === "layout")).toBe(true);
    expect(fontOnly).toHaveLength(14);

    const colorsOnly = baseMapWrites(MAPBOX_DARK_V11_LAYERS, { ...MIAMI, labelFont: null });
    expect(colorsOnly.every((w) => w.kind === "paint")).toBe(true);
    expect(colorsOnly).toHaveLength(64);
  });
});

describe("applyBaseMap", () => {
  function fakeMap() {
    return {
      getStyle: vi.fn(() => ({
        version: 8 as const,
        sources: {},
        layers: [...MAPBOX_DARK_V11_LAYERS],
      })),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
    };
  }

  it("sends each write to the map", () => {
    const map = fakeMap();
    applyBaseMap(map as unknown as Parameters<typeof applyBaseMap>[0], MIAMI);
    expect(map.setPaintProperty).toHaveBeenCalledTimes(64);
    expect(map.setPaintProperty).toHaveBeenCalledWith("water", "fill-color", MIAMI.palette.water);
    expect(map.setLayoutProperty).toHaveBeenCalledTimes(14);
  });

  it("doesn't read the style for the stock map", () => {
    const map = fakeMap();
    applyBaseMap(map as unknown as Parameters<typeof applyBaseMap>[0], {
      palette: null,
      labelFont: null,
    });
    expect(map.getStyle).not.toHaveBeenCalled();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });
});

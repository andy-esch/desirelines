import type { ThemeMap } from "./registry";

/**
 * Base-map recolors for the retro themes, for their theme entries' `map` field once those
 * entries exist. Both recolor the stock `dark-v11` style. Every `SPORT_COLORS` entry must
 * clear 3:1 against land, park and water (`sportConfig.test.ts`); the tightest is
 * watersports, at about 3.1:1 in both.
 */
export const RETRO_BASE_MAPS = {
  miami: {
    palette: {
      land: "#130a29",
      park: "#1a1136",
      water: "#0a0520",
      building: "#1c1138",
      roadMinor: "#24173f",
      roadPrimary: "#3a1f5c",
      roadMotorway: "#6a1762",
      tunnel: "#1e1240",
      admin: "#5a3f86",
      label: "#8b7bb5",
      labelStrong: "#c9b8e0",
      labelHalo: "#0e0620",
    },
    labelFont: "Roboto Mono Regular",
  },
  arcade: {
    palette: {
      land: "#000000",
      park: "#021010",
      water: "#001a1d",
      building: "#04181b",
      roadMinor: "#082226",
      roadPrimary: "#0d3a40",
      roadMotorway: "#13606a",
      tunnel: "#061c1f",
      admin: "#3a2a55",
      label: "#5d7a80",
      labelStrong: "#a3a5a6",
      labelHalo: "#000000",
    },
    labelFont: "Roboto Mono Regular",
  },
} as const satisfies Record<string, ThemeMap>;

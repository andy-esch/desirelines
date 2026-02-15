/**
 * Per-sport page background gradients.
 *
 * Each sport gets a unique gradient using its color family.
 * Angles vary between 110-145deg for visual variety across pages.
 * No green/yellow pairings — secondary color shifts to cyan or magenta.
 */

const SPORT_GRADIENTS: Record<string, string> = {
  // Endurance — Cyan/Blue family
  cycling: "linear-gradient(130deg, rgba(0, 255, 255, 0.18) 0%, rgba(255, 0, 255, 0.08) 100%)",
  running: "linear-gradient(115deg, rgba(0, 200, 255, 0.18) 0%, rgba(0, 255, 255, 0.08) 100%)",
  swimming: "linear-gradient(135deg, rgba(0, 150, 255, 0.18) 0%, rgba(0, 255, 255, 0.08) 100%)",
  ebike: "linear-gradient(125deg, rgba(100, 220, 255, 0.18) 0%, rgba(0, 255, 255, 0.08) 100%)",

  // Outdoor/Adventure — Green/Teal family
  hiking: "linear-gradient(145deg, rgba(0, 255, 128, 0.18) 0%, rgba(0, 255, 255, 0.08) 100%)",
  walking: "linear-gradient(125deg, rgba(100, 255, 150, 0.18) 0%, rgba(0, 255, 255, 0.08) 100%)",
  winter_sports:
    "linear-gradient(140deg, rgba(150, 255, 200, 0.18) 0%, rgba(0, 200, 255, 0.08) 100%)",
  watersports: "linear-gradient(145deg, rgba(0, 200, 180, 0.18) 0%, rgba(0, 150, 255, 0.08) 100%)",

  // Fitness/Mind-Body — Magenta/Pink family
  yoga: "linear-gradient(120deg, rgba(255, 0, 255, 0.18) 0%, rgba(180, 0, 255, 0.08) 100%)",
  workout: "linear-gradient(110deg, rgba(255, 100, 200, 0.18) 0%, rgba(255, 0, 255, 0.08) 100%)",
  climbing: "linear-gradient(115deg, rgba(200, 50, 255, 0.18) 0%, rgba(255, 0, 255, 0.08) 100%)",

  // Ball/Racket — Yellow/Orange family (paired with magenta, not green)
  racket_sports:
    "linear-gradient(140deg, rgba(255, 200, 0, 0.18) 0%, rgba(255, 0, 255, 0.08) 100%)",
  team_sports: "linear-gradient(110deg, rgba(255, 150, 50, 0.18) 0%, rgba(255, 0, 255, 0.08) 100%)",
  golf: "linear-gradient(135deg, rgba(200, 255, 100, 0.18) 0%, rgba(0, 255, 255, 0.08) 100%)",

  // Alternative Transport — Purple family
  skating: "linear-gradient(130deg, rgba(180, 100, 255, 0.18) 0%, rgba(0, 200, 255, 0.08) 100%)",
  wheelchair: "linear-gradient(120deg, rgba(150, 150, 255, 0.18) 0%, rgba(0, 200, 255, 0.08) 100%)",
};

const DEFAULT_GRADIENT =
  "linear-gradient(130deg, rgba(0, 255, 255, 0.15) 0%, rgba(255, 0, 255, 0.08) 100%)";

export function getSportGradient(sport: string): string {
  return SPORT_GRADIENTS[sport] || DEFAULT_GRADIENT;
}

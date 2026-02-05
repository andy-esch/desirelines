/**
 * Activity Name Generator
 *
 * Generates varied, realistic activity names with time-of-day awareness
 * and occasional 80s pop culture easter eggs.
 */

// =============================================================================
// Types
// =============================================================================

type TimeOfDay = "morning" | "lunch" | "afternoon" | "evening";

// =============================================================================
// Time-of-Day Helpers
// =============================================================================

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 13) return "lunch";
  if (hour >= 13 && hour < 17) return "afternoon";
  return "evening";
}

const TIME_PREFIXES: Record<TimeOfDay, string[]> = {
  morning: ["Morning", "Early Morning", "Sunrise", "Dawn"],
  lunch: ["Lunch", "Midday", "Noon"],
  afternoon: ["Afternoon", "Post-Lunch"],
  evening: ["Evening", "Sunset", "Twilight"],
};

// =============================================================================
// Sport-Specific Name Pools
// =============================================================================

interface SportNamePool {
  suffixes: string[];
  creative: string[];
  easterEggs: string[];
}

const CYCLING_NAMES: SportNamePool = {
  suffixes: ["Ride", "Spin", "Loop", "Cruise", "Pedal"],
  creative: [
    "Hill Repeats",
    "Recovery Spin",
    "Coffee Shop Ride",
    "Commute",
    "Group Ride",
    "Solo Adventure",
    "Legs Day",
    "Gravel Grind",
    "Tempo Effort",
    "Zone 2 Spin",
    "Headwind Sufferfest",
    "Tailwind Express",
    "Flat & Fast",
    "Climbing Day",
    "Base Miles",
    "Easy Rollers",
    "Chain Gang",
    "Interval Session",
    "Weekend Long Ride",
    "Quick Spin",
  ],
  easterEggs: [
    "Bicycle Race (Queen Approved)",
    "Tour de Fridge",
    "Breaking Away",
    "Ride Like the Wind",
    "I Want to Ride My Bicycle",
    "Take On Me (On Two Wheels)",
  ],
};

const RUNNING_NAMES: SportNamePool = {
  suffixes: ["Run", "Jog", "Miles", "Stride"],
  creative: [
    "Tempo Run",
    "Easy Recovery",
    "Trail Run",
    "Interval Training",
    "Fartlek",
    "Long Run",
    "Progression Run",
    "Strides",
    "Speed Work",
    "Threshold Effort",
    "Shakeout Run",
    "Negative Splits",
    "Out & Back",
    "Track Session",
    "Hill Sprints",
    "Treadmill Session",
    "Cool Down Jog",
    "Race Day",
    "Recovery Shuffle",
    "Steady State",
  ],
  easterEggs: [
    "Running Up That Hill (Literally)",
    "Eye of the Tiger Tempo",
    "Born to Run",
    "Footloose & Fancy Free",
    "Don't Stop Me Now",
    "Take On Me Tempo",
  ],
};

const YOGA_NAMES: SportNamePool = {
  suffixes: ["Flow", "Practice", "Session", "Stretch"],
  creative: [
    "Vinyasa Flow",
    "Yin Yoga",
    "Power Yoga",
    "Restorative Practice",
    "Sun Salutations",
    "Hip Opener Flow",
    "Balance & Strength",
    "Meditation & Stretch",
    "Deep Stretch",
    "Core Flow",
    "Breathwork & Movement",
    "Slow Flow",
    "Flexibility Focus",
    "Gentle Stretch",
    "Warrior Sequence",
    "Inversion Practice",
    "Ashtanga Session",
    "Yoga Nidra",
    "Heart Opener Flow",
    "Full Body Unwind",
  ],
  easterEggs: [
    "Karma Chameleon Flow",
    "Let's Get Physical (Namaste)",
    "Total Eclipse of the Asana",
    "Thriller Stretch",
    "Like a Prayer Pose",
    "Relax (Don't Do It)",
  ],
};

const HIKING_NAMES: SportNamePool = {
  suffixes: ["Hike", "Trek", "Walk", "Ramble"],
  creative: [
    "Trail Exploration",
    "Summit Attempt",
    "Nature Walk",
    "Canyon Trek",
    "Ridge Walk",
    "Forest Trail",
    "Weekend Adventure",
    "Peak Bagging",
    "Backcountry Hike",
    "Scramble",
    "Wildflower Walk",
    "Waterfall Trail",
    "Loop Trail",
    "Out & Back",
    "Lakeside Path",
    "Sunset Stroll",
    "Valley Traverse",
    "Alpine Approach",
    "Ridgeline Wander",
    "Trailhead to Summit",
  ],
  easterEggs: [
    "Walk Like an Egyptian",
    "Every Breath You Take (at Altitude)",
    "Don't You Forget About Trail Mix",
    "Take a Walk on the Wild Side",
    "Walking on Sunshine",
    "The Final Countdown (to Summit)",
  ],
};

const WORKOUT_NAMES: SportNamePool = {
  suffixes: ["Workout", "Session", "Training", "Pump"],
  creative: [
    "Strength Training",
    "HIIT Session",
    "CrossFit WOD",
    "Upper Body Day",
    "Lower Body Day",
    "Core Workout",
    "Cardio Session",
    "Circuit Training",
    "Recovery Session",
    "Full Body Workout",
    "Push Day",
    "Pull Day",
    "Leg Day",
    "Kettlebell Flow",
    "Bodyweight Blast",
    "Tabata Rounds",
    "Functional Fitness",
    "Mobility Work",
    "Dumbbell Complex",
    "Sweat Session",
  ],
  easterEggs: [
    "Pump Up the Jam",
    "Physical (Olivia Newton-John Style)",
    "Maniac on the Floor",
    "Flashdance Workout",
    "Eye of the Tiger Reps",
    "Gonna Fly Now",
  ],
};

const SPORT_NAME_POOLS: Record<string, SportNamePool> = {
  cycling: CYCLING_NAMES,
  running: RUNNING_NAMES,
  yoga: YOGA_NAMES,
  hiking: HIKING_NAMES,
  workout: WORKOUT_NAMES,
};

// Generic fallback pool for unknown/dynamic sports
const GENERIC_NAMES: SportNamePool = {
  suffixes: ["Session", "Activity", "Workout"],
  creative: [
    "Quick Session",
    "Long Session",
    "Solo Session",
    "Weekend Fun",
    "Active Recovery",
    "Training Day",
  ],
  easterEggs: ["Don't Stop Believin'", "Livin' on a Prayer", "Here I Go Again"],
};

// =============================================================================
// Generator
// =============================================================================

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a realistic activity name based on sport and time of day.
 *
 * Weighted distribution:
 * - ~60% time-of-day + sport suffix: "Morning Ride", "Evening Run"
 * - ~35% creative/descriptive: "Hill Repeats", "Recovery Spin", "Fartlek"
 * - ~5% 80s pop culture easter eggs
 *
 * @param sport - Sport key (e.g., "cycling", "running")
 * @param hour - Hour of day (0-23) for time-of-day awareness
 */
export function generateActivityName(sport: string, hour: number): string {
  const pool = SPORT_NAME_POOLS[sport] ?? GENERIC_NAMES;
  const timeOfDay = getTimeOfDay(hour);
  const roll = Math.random();

  if (roll < 0.05) {
    // 5% - 80s easter eggs
    return randomChoice(pool.easterEggs);
  }

  if (roll < 0.4) {
    // 35% - creative/descriptive names
    return randomChoice(pool.creative);
  }

  // 60% - time-of-day prefix + sport suffix
  const prefix = randomChoice(TIME_PREFIXES[timeOfDay]);
  const suffix = randomChoice(pool.suffixes);
  return `${prefix} ${suffix}`;
}

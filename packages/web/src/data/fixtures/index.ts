import activities2023 from "./activities/2023/distances.json";
import activities2024 from "./activities/2024/distances.json";
import activities2025 from "./activities/2025/distances.json";
import activities2026 from "./activities/2026/distances.json";
import type { RideBlobType } from "../../types/activity";
import type { GoalsForYear } from "../../types/generated/user_config";

// Map of year -> fixture data
export const FIXTURE_ACTIVITIES: Record<number, RideBlobType> = {
  2023: activities2023 as RideBlobType,
  2024: activities2024 as RideBlobType,
  2025: activities2025 as RideBlobType,
  2026: activities2026 as RideBlobType,
};

// Default demo goals (using proper protobuf structure)
export const FIXTURE_GOALS: GoalsForYear = {
  goals: [
    {
      id: "1",
      value: 2000,
      label: "Conservative",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "2",
      value: 2500,
      label: "Target",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "3",
      value: 3000,
      label: "Stretch",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ],
};

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names: `clsx` for conditional composition + `tailwind-merge` to
 * de-conflict overlapping Tailwind utilities. The shadcn/ui `cn` convention,
 * used by all shadcn-style components.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

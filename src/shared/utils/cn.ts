import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class names, resolving conflicts (e.g. `p-2 p-4` → `p-4`)
 * in favor of the last one. Used by every component in
 * `presentation/components/ui`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

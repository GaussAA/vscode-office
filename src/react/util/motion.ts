/*
 * Motion tokens for TypeScript consumers (ADR-0022).
 *
 * CSS gets the same values from `motion.less` as custom properties. Two files, one rule: change
 * a duration in both or neither, and keep the reduced-motion condition identical (a JS animation
 * that ignores the preference is worse than a CSS one, because nothing zeroes it).
 *
 * Only reach for this module when the animation cannot be expressed in CSS — e.g. handing
 * antd's own `motion` token the user's preference.
 */

export const MOTION_FAST_MS = 120;
export const MOTION_BASE_MS = 160;
export const MOTION_SLOW_MS = 180;
export const MOTION_EASE = "cubic-bezier(0.2, 0, 0, 1)";

/** False when the user asked the system to reduce motion. */
export function motionEnabled(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

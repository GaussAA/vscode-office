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

/** Fast animation duration in milliseconds (120ms) */
export const MOTION_FAST_MS = 120;

/** Base animation duration in milliseconds (160ms) */
export const MOTION_BASE_MS = 160;

/** Slow animation duration in milliseconds (180ms) */
export const MOTION_SLOW_MS = 180;

/** Standard easing function for smooth animations */
export const MOTION_EASE = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * Check if motion/animations are enabled based on user preference.
 *
 * Returns false when the user has enabled "prefers-reduced-motion" in their
 * system settings, indicating they want minimal animation.
 *
 * @returns true if animations should play, false if they should be reduced/skipped
 * @example
 * ```ts
 * const duration = motionEnabled() ? MOTION_BASE_MS : 0;
 * ```
 */
export function motionEnabled(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

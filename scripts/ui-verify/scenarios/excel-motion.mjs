import { expect, json } from "../helpers.mjs";

/**
 * The reduced-motion promise has to hold in every viewer, not just the one that got the motion
 * pass (ADR-0023). Excel carries the same tokens now, so this scenario proves three things:
 * the tokens reach the excel bundle, they resolve to `0s` under the preference, and an element
 * that actually carries a transition reports a zero duration.
 */
export default [
  {
    name: "excel-reduced-motion",
    async run({ page, base, setReducedMotion }) {
      // Set before navigating: the media query is read when the stylesheet is applied.
      await setReducedMotion(true);
      await page.navigate(`${base}/harness-route?route=excel`);
      const ready = await page.waitFor(`!!document.querySelector('#root')?.children.length`);
      expect(ready, "the excel route did not mount");

      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const root = getComputedStyle(document.documentElement);
                // The toolbar button owns 'transition: background var(--motion-fast)', so it is
                // the element that proves the token reached a real transition, not just :root.
                const candidates = [
                    '.x-spreadsheet-toolbar .x-spreadsheet-toolbar-btn',
                    '.x-spreadsheet-toolbar button',
                ];
                const element = candidates
                    .map((selector) => document.querySelector(selector))
                    .find((node) => node && getComputedStyle(node).transitionDuration !== '');
                return {
                    fast: root.getPropertyValue('--motion-fast').trim(),
                    base: root.getPropertyValue('--motion-base').trim(),
                    slideIn: root.getPropertyValue('--motion-slow').trim(),
                    sampled: element ? element.className : null,
                    transition: element ? getComputedStyle(element).transitionDuration : null,
                };
            })())`),
      );

      // One token resolving to 0s proves motion.less reached this bundle; all three prove the
      // media query zeroed the group rather than one value.
      expect(
        state.fast === "0s" && state.base === "0s" && state.slideIn === "0s",
        `motion tokens are ${state.fast}/${state.base}/${state.slideIn} under reduced motion`,
      );
      // A sampled element is optional (the toolbar differs between builds), but when one exists
      // its duration must be zero — a literal left behind would show up here.
      if (state.sampled) {
        const zero = String(state.transition)
          .split(",")
          .every((value) => value.trim() === "0s" || value.trim() === "0s 0s");
        expect(zero, `${state.sampled} still transitions: ${state.transition}`);
      }
      return `tokens zeroed (${state.fast}/${state.base}/${state.slideIn})${state.sampled ? `, sampled ${state.transition}` : ", no sample"}`;
    },
  },
];

import { openParquet } from "../helpers.mjs";

/**
 * The three surface levels (DESIGN.md) have to be visible as three different colours, and the
 * order has to be `canvas` → `surface` → `raised` in both themes.
 *
 * The check is theme-agnostic on purpose: mixing the foreground into the canvas moves it away
 * from the canvas in one direction, and `raised` must have moved further than `surface`. A
 * hard-coded "lighter" assertion would pass on dark themes and fail on light ones — while the
 * real defect (a panel that sinks into the bottom bar) would still be there.
 */

/**
 * Relative luminance of any computed colour, 0–1.
 *
 * `color-mix()` does not compute to `rgb()`: Chrome reports `color(srgb 0.14 0.14 0.14)`, so a
 * parser that only knows `rgb()` sees no colour at all and the assertion fails for the wrong
 * reason.
 */
function luminanceOf(color) {
  const text = (color ?? "").trim();
  let components = null;
  const rgb = /^rgba?\(([^)]+)\)/.exec(text);
  if (rgb) {
    components = rgb[1]
      .split(",")
      .slice(0, 3)
      .map((value) => Number.parseFloat(value.trim()) / 255);
  } else {
    const srgb = /^color\(srgb\s+([^)]+)\)/.exec(text);
    if (srgb) {
      components = srgb[1]
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .map((value) => Number.parseFloat(value));
    }
  }
  if (!components || components.some((value) => Number.isNaN(value))) return null;
  const channel = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = components.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function levelsOf(page, base, theme) {
  await openParquet(page, base, `?profile=1&theme=${theme}`);
  // The docked panel is the only region on the `raised` level, so it has to be on screen.
  await page.evaluate(`(() => {
        const row = document.querySelector('.parquet-viewer__list-item');
        row?.focus();
        row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    })()`);
  const opened = await page.waitFor(`!!document.querySelector('.parquet-viewer__profile')`);
  if (!opened) return null;
  return JSON.parse(
    await page.evaluate(`JSON.stringify((() => {
            const colour = (selector) => {
                const node = document.querySelector(selector);
                return node ? getComputedStyle(node).backgroundColor : null;
            };
            return {
                canvas: colour('.parquet-viewer__main'),
                surface: colour('.parquet-viewer__topbar'),
                raised: colour('.parquet-viewer__profile'),
            };
        })())`),
  );
}

export default [
  {
    name: "parquet-surface-levels",
    async run({ page, base }) {
      const report = [];
      for (const theme of ["dark", "light"]) {
        const levels = await levelsOf(page, base, theme);
        if (!levels)
          throw new Error(`${theme}: the docked panel never opened, no raised level to measure`);

        const canvas = luminanceOf(levels.canvas);
        const surface = luminanceOf(levels.surface);
        const raised = luminanceOf(levels.raised);
        if (canvas === null || surface === null || raised === null) {
          throw new Error(`${theme}: a surface reported no colour: ${JSON.stringify(levels)}`);
        }

        // Three levels, three colours: two of them being equal is the whole feature missing.
        if (levels.canvas === levels.surface || levels.surface === levels.raised) {
          throw new Error(`${theme}: surfaces collapse into one colour: ${JSON.stringify(levels)}`);
        }

        const surfaceStep = surface - canvas;
        const raisedStep = raised - canvas;
        if (Math.abs(surfaceStep) < 1e-4) {
          throw new Error(`${theme}: surface is the canvas colour: ${JSON.stringify(levels)}`);
        }
        if (Math.sign(surfaceStep) !== Math.sign(raisedStep)) {
          throw new Error(
            `${theme}: raised moves the other way from surface: ${JSON.stringify(levels)}`,
          );
        }
        if (Math.abs(raisedStep) <= Math.abs(surfaceStep)) {
          throw new Error(
            `${theme}: raised is not further from the canvas than surface: ${JSON.stringify(levels)}`,
          );
        }
        report.push(`${theme} Δsurface=${surfaceStep.toFixed(4)} Δraised=${raisedStep.toFixed(4)}`);
      }
      return `three levels, same order in both themes (${report.join(" · ")})`;
    },
  },
];

/**
 * Browser driver for the UI verification suite.
 *
 * This used to be a hand-written Chrome DevTools Protocol client whose header said
 * "No puppeteer: the repo already needs Chrome for nothing". That was false: `puppeteer-core`
 * is a *runtime* dependency (the Markdown export path launches Chrome with it), and
 * `@puppeteer/browsers` comes with it. So the suite now uses the same driver the product
 * uses, and the two hand-maintained "where is Chrome installed" tables collapse into one.
 *
 * `findBrowser()` still prefers an explicit `CHROME_PATH` / known location, because CI images
 * and developer machines both like deterministic answers, and falls back to
 * `computeSystemExecutablePath` for the platforms we have no entry for.
 */
import { Browser, ChromeReleaseChannel, computeSystemExecutablePath } from "@puppeteer/browsers";
import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findBrowser() {
  const explicit = CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  if (explicit) return explicit;
  try {
    return computeSystemExecutablePath({
      browser: Browser.CHROME,
      channel: ChromeReleaseChannel.STABLE,
    });
  } catch {
    return null;
  }
}

export async function launchBrowser({ headless = true, width = 1500, height = 850 } = {}) {
  const executablePath = findBrowser();
  if (!executablePath) {
    throw new Error("No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.");
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless,
    defaultViewport: { width, height },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // CI containers: the sandbox needs privileges the runner lacks, and /dev/shm is
      // small enough that Chrome dies before it paints anything.
      ...(process.platform === "linux"
        ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        : []),
    ],
  });

  const page = await browser.newPage();

  // Uncaught page errors are evidence too: a view that throws while mounting is broken
  // even if the DOM looks present.
  const exceptions = [];
  // CSP violations do NOT reach `page.on('console')` — Chrome emits them through the `Log`
  // domain with source `security`, which Puppeteer does not forward. Without this session
  // the policy check silently passes no matter how broken the policy is (verified: removing
  // `'unsafe-inline'` from `style-src` went from red to green when this moved to Puppeteer).
  const violations = [];
  page.on("pageerror", (error) => {
    exceptions.push(error?.message ?? String(error));
  });
  const session = await page.createCDPSession();
  await session.send("Log.enable");
  session.on("Log.entryAdded", ({ entry }) => {
    const text = entry?.text ?? "";
    if (entry?.source === "security" || /Content Security Policy/i.test(text)) {
      violations.push(text);
    }
  });

  return {
    navigate: async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    evaluate: (expression) => page.evaluate(expression),
    screenshot: async (file) => {
      await page.screenshot({ path: file });
    },
    waitFor: async (expression, timeoutMs = 8000) => {
      const started = Date.now();
      const deadline = started + timeoutMs;
      while (Date.now() < deadline) {
        if (await page.evaluate(expression)) return true;
        await sleep(120);
      }
      // The caller's assertion message says *what* did not happen; this line says *which*
      // expression and for how long. Without it a flake leaves no trace of the wait itself.
      console.warn(
        `[ui-verify] waitFor timed out after ${Date.now() - started}ms: ${expression.replace(/\s+/g, " ").slice(0, 160)}`,
      );
      return false;
    },
    sleep,
    exceptions: () => [...exceptions],
    violations: () => [...violations],
    clearViolations: () => {
      violations.length = 0;
    },
    clearExceptions: () => {
      exceptions.length = 0;
    },
    close: async () => {
      try {
        await browser.close();
      } catch {
        // a browser that already died is a closed browser
      }
    },
  };
}

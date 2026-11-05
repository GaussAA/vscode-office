/**
 * UI verification: build the app, serve it with fake VS Code bridges, drive headless
 * Chrome through CDP, assert the DOM, and write screenshots.
 *
 *   node scripts/ui-verify/runner.mjs            # assert only
 *   node scripts/ui-verify/runner.mjs --docs     # also refresh docs/screenshots
 *   node scripts/ui-verify/runner.mjs --filter=parquet
 *   node scripts/ui-verify/runner.mjs --headed   # watch it run
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './cdp.mjs'
import { createFixtures, repoRoot } from './fixtures.mjs'
import { startHarness } from './harness.mjs'

const args = process.argv.slice(2)
const filter = args.find(arg => arg.startsWith('--filter='))?.slice('--filter='.length)
const refreshDocs = args.includes('--docs')
const headed = args.includes('--headed')

const shotsDir = join(repoRoot, '.ui-verify', 'shots')
const docsDir = join(repoRoot, 'docs', 'screenshots')

mkdirSync(shotsDir, { recursive: true })

function expect(condition, message) {
    if (!condition) throw new Error(message)
}

const json = value => JSON.parse(value)

async function openJsonl(page, base, theme = 'dark') {
    await page.navigate(`${base}/harness?theme=${theme}`)
    const ready = await page.waitFor(`!!document.querySelector('.jsonl-index__tree .ant-tree-treenode')`)
    expect(ready, 'JSONL directory did not render')
}

async function jumpJsonl(page, entry) {
    await page.evaluate(`(() => {
        const input = document.querySelector('.jsonl-jump input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(String(entry))});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const go = [...document.querySelectorAll('.jsonl-toolbar button')].find(b => b.textContent.trim() === 'Go');
        go.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()`)
    // The header flips to the new line as soon as the request is issued; the body is what the
    // scenarios assert on, so wait for it too.
    const loaded = await page.waitFor(`(() => {
        if (document.querySelector('.jsonl-detail__index')?.innerText.trim() !== ${JSON.stringify(`L${entry}`)}) return false;
        return !!document.querySelector('.jsonl-detail__tree, .jsonl-detail__scalar, .jsonl-detail__raw');
    })()`)
    expect(loaded, `entry L${entry} never finished rendering`)
}

async function openParquet(page, base, query = '') {
    await page.navigate(`${base}/harness-parquet${query}`)
    // antd renders a No data row before the first page arrives, so wait for a real cell
    const ready = await page.waitFor(`!!document.querySelector('.parquet-viewer__cell')`)
    expect(ready, 'parquet table did not render')
}

const pagerState = page => page.evaluate(`JSON.stringify({
    range: document.querySelector('.parquet-viewer__pager-info')?.innerText ?? null,
    first: document.querySelector('.parquet-table tbody tr:nth-child(2) td')?.innerText ?? null,
    banner: document.querySelector('.parquet-viewer__readonly-banner')?.innerText ?? null,
})`).then(json)

async function clickNextPage(page) {
    const before = (await pagerState(page)).range
    await page.evaluate(`[...document.querySelectorAll('.parquet-viewer__pager-btn')]
        .filter(b => b.getAttribute('aria-label') === 'Next page')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    const moved = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') !== ${JSON.stringify(before)}`,
    )
    expect(moved, `pager stayed on ${before}`)
}

const scenarios = [
    {
        name: 'jsonl-directory',
        docs: 'jsonl-two-pane.png',
        async run({ page, base }) {
            await openJsonl(page, base)
            const state = json(await page.evaluate(`JSON.stringify({
                file: document.querySelector('.jsonl-file-name')?.innerText ?? null,
                meta: document.querySelector('.jsonl-meta')?.innerText ?? null,
                index: document.querySelector('.jsonl-detail__index')?.innerText ?? null,
                rows: document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode').length,
            })`))
            expect(state.file === 'events.jsonl', `unexpected file name: ${state.file}`)
            expect(state.rows >= 10, `directory rendered ${state.rows} rows`)
            expect(state.index === 'L1', `unexpected first selection: ${state.index}`)
            expect(/entries/.test(state.meta ?? ''), `missing entry count: ${state.meta}`)
            return `${state.rows} rows, ${state.meta}`
        },
    },
    {
        name: 'jsonl-wrap-long-value',
        docs: 'jsonl-wrap.png',
        async run({ page, base }) {
            await openJsonl(page, base)
            await jumpJsonl(page, 13)
            const state = json(await page.evaluate(`JSON.stringify((() => {
                const wrap = [...document.querySelectorAll('.jsonl-val--wrap')].find(n => n.textContent.length > 100);
                return {
                    scroll: !!document.querySelector('.jsonl-detail__scroll'),
                    count: document.querySelectorAll('.jsonl-val--wrap').length,
                    height: wrap ? Math.round(wrap.getBoundingClientRect().height) : 0,
                };
            })())`))
            expect(state.scroll, 'wrap mode did not switch off virtual scrolling')
            expect(state.count > 0, 'no wrapped values rendered')
            expect(state.height > 30, `wrapped value is only ${state.height}px tall`)
            return `${state.count} wrapped values, tallest ${state.height}px`
        },
    },
    {
        name: 'jsonl-big-entry-stays-single-line',
        async run({ page, base }) {
            await openJsonl(page, base)
            await jumpJsonl(page, 14)
            const state = json(await page.evaluate(`JSON.stringify({
                scroll: !!document.querySelector('.jsonl-detail__scroll'),
                count: document.querySelectorAll('.jsonl-val--wrap').length,
                tree: !!document.querySelector('.jsonl-detail__tree'),
            })`))
            expect(state.tree, 'big entry rendered no tree')
            expect(!state.scroll, '600-key entry wrongly enabled wrapping')
            expect(state.count === 0, `600-key entry produced ${state.count} wrapped values`)
            return 'virtual single-line mode'
        },
    },
    {
        name: 'jsonl-search',
        async run({ page, base }) {
            await openJsonl(page, base)
            await page.evaluate(`(() => {
                const input = document.querySelector('.jsonl-search input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                input.focus();
                setter.call(input, 'id');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`)
            const sawBanner = await page.waitFor(`!!document.querySelector('.jsonl-index__banner')`)
            expect(sawBanner, 'search banner never appeared')
            const sawHits = await page.waitFor(`document.querySelectorAll('.jsonl-hit').length > 0`)
            expect(sawHits, 'no match highlighting rendered')
            // Settled means: a match count, and no longer "Searching…".
            const settled = await page.waitFor(`(() => {
                const text = document.querySelector('.jsonl-index__banner')?.innerText ?? '';
                return /\\d+ match/.test(text) && !text.includes('Searching');
            })()`)
            expect(settled, 'search banner never settled on a match count')
            const state = json(await page.evaluate(`JSON.stringify({
                banner: document.querySelector('.jsonl-index__banner')?.innerText ?? null,
                hits: document.querySelectorAll('.jsonl-hit').length,
            })`))
            expect(/(\d+) match/.test(state.banner ?? ''), `unexpected banner: ${state.banner}`)
            expect(state.hits > 0, 'no match highlighting rendered')
            return `${state.banner}, ${state.hits} highlighted runs`
        },
    },
    {
        name: 'parquet-paging',
        docs: 'parquet-types.png',
        async run({ page, base }) {
            await openParquet(page, base, '?mixed=1')
            const first = await pagerState(page)
            expect(first.range === '1–50 of 300', `page 1 range: ${first.range}`)
            expect(first.first === '1', `page 1 first row: ${first.first}`)
            await clickNextPage(page)
            const second = await pagerState(page)
            expect(second.range === '51–100 of 300', `page 2 range: ${second.range}`)
            expect(second.first === '51', `page 2 first row: ${second.first}`)
            return `1–50 then 51–100 of 300`
        },
    },
    {
        name: 'parquet-large-readonly',
        docs: 'parquet-large-file.png',
        async run({ page, base }) {
            await openParquet(page, base, '?big=1')
            const state = await pagerState(page)
            expect(/Read-only/.test(state.banner ?? ''), `missing read-only banner: ${state.banner}`)
            expect(state.range === '1–50 of 250,000', `large range: ${state.range}`)
            await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__row-jump');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '240000');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                [...document.querySelectorAll('.parquet-viewer__pager-btn')]
                    .find(b => b.textContent.trim() === 'Go')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`)
            const arrived = await page.waitFor(
                `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '').includes('239,951')`,
            )
            expect(arrived, 'jump never reached row 239,951')
            const jumped = await pagerState(page)
            expect(jumped.range === '239,951–240,000 of 250,000', `jump range: ${jumped.range}`)
            expect(jumped.first === '239951', `jump first row: ${jumped.first}`)
            return 'read-only + jump to row 240,000'
        },
    },
    {
        name: 'parquet-inspector',
        docs: 'parquet-inspector.png',
        async run({ page, base }) {
            await openParquet(page, base, '?mixed=1')
            await page.evaluate(`(() => {
                const cell = document.querySelector('.parquet-table tbody tr:nth-child(2) td:nth-child(3) .parquet-viewer__cell');
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`)
            const inspected = await page.waitFor(
                `/name · row 1/.test(document.querySelector('.parquet-viewer__inspector-label')?.innerText ?? '')`,
            )
            expect(inspected, 'inspector never showed name · row 1')
            const state = json(await page.evaluate(`JSON.stringify({
                label: document.querySelector('.parquet-viewer__inspector-label')?.innerText ?? null,
                value: document.querySelector('.parquet-viewer__inspector-value')?.innerText ?? null,
            })`))
            expect(/name · row 1/.test(state.label ?? ''), `unexpected inspector label: ${state.label}`)
            expect((state.value ?? '').length > 0, 'inspector showed no value')
            await clickNextPage(page)
            const cleared = await page.evaluate(`!document.querySelector('.parquet-viewer__inspector')`)
            expect(cleared, 'inspector survived a page change')
            return `${state.label} = ${state.value}`
        },
    },
    {
        name: 'parquet-search',
        docs: 'parquet-search.png',
        async run({ page, base }) {
            await openParquet(page, base, '?mixed=1')
            await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'service-c-54');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('.parquet-viewer__find-btn')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`)
            const done = await page.waitFor(
                `document.querySelector('.parquet-viewer__find-count')?.innerText === '1 row'`, 15000)
            expect(done, 'whole-file search did not report a match')
            const state = json(await page.evaluate(`JSON.stringify({
                count: document.querySelector('.parquet-viewer__find-count')?.innerText ?? null,
                hits: document.querySelectorAll('.parquet-viewer__hit').length,
                rows: document.querySelectorAll('.parquet-viewer__row--match').length,
                range: document.querySelector('.parquet-viewer__pager-info')?.innerText ?? null,
            })`))
            expect(state.count === '1 row', `unexpected match count: ${state.count}`)
            expect(state.hits > 0, 'matched cell was not highlighted')
            expect(state.rows === 1, `expected 1 marked row, got ${state.rows}`)
            expect(state.range === '51–100 of 300', `did not jump to the match page: ${state.range}`)
            return `${state.count} at ${state.range}, ${state.hits} highlighted cell(s)`
        },
    },    {
        name: 'upstream-viewers-smoke',
        async run({ page, base }) {
            // React routes only: html/pdf are provider-served static pages and markdown has its own editor bundle.
            const routes = ['image', 'svg', 'excel', 'zip', 'word', 'ppt', 'font', 'epub', 'icns', 'psd', 'xmind', 'gitHistory', 'webUnsupported']
            const failures = []
            for (const route of routes) {
                page.clearExceptions()
                await page.navigate(`${base}/harness-route?route=${route}`)
                // Poll instead of sleeping: the excel/epub chunks are ~1 MB and mount slower on
                // a loaded machine than any fixed delay we would pick (this used to flake).
                const mounted = await page.waitFor(`!!document.querySelector('#root')?.children.length`, 6000)
                const errors = page.exceptions()
                if (!mounted) failures.push(`${route}: nothing mounted`)
                if (errors.length) failures.push(`${route}: ${errors[0].split('\n')[0]}`)
            }
            expect(failures.length === 0, failures.join(' | '))
            return `${routes.length} routes mounted without uncaught errors`
        },
    },    {
        name: 'parquet-prefetch',
        async run({ page, base, stats }) {
            await openParquet(page, base, '?mixed=1')
            const before = await stats()
            await clickNextPage(page)
            const after = await stats()
            const delta = after.ranged - before.ranged
            expect(delta === 0, `page 2 needed ${delta} extra range requests (prefetch is broken)`)
            const state = await pagerState(page)
            expect(state.range === '51–100 of 300', `page 2 did not render: ${state.range}`)
            return `next page served from cache (0 extra reads)`
        },
    },
]

async function main() {
    const fixtures = createFixtures(join(repoRoot, '.ui-verify'))
    const harness = await startHarness(fixtures)
    let browser
    let failures = 0
    const results = []

    try {
        browser = await launchBrowser({ headless: !headed })
        const selected = scenarios.filter(scenario => !filter || scenario.name.includes(filter))
        if (selected.length === 0) throw new Error(`no scenario matches --filter=${filter}`)

        for (const scenario of selected) {
            const started = Date.now()
            const context = {
                page: browser,
                base: harness.url,
                stats: async () => (await fetch(`${harness.url}/stats`)).json(),
            }
            try {
                const detail = await scenario.run(context)
                await browser.screenshot(join(shotsDir, `${scenario.name}.png`))
                if (refreshDocs && scenario.docs) {
                    copyFileSync(join(shotsDir, `${scenario.name}.png`), join(docsDir, scenario.docs))
                }
                results.push({ name: scenario.name, ok: true, detail, ms: Date.now() - started })
            } catch (error) {
                results.push({ name: scenario.name, ok: false, detail: error.message, ms: Date.now() - started })
                failures++
            }
        }
    } finally {
        if (browser) await browser.close()
        await harness.close()
    }

    for (const result of results) {
        const mark = result.ok ? 'PASS' : 'FAIL'
        console.log(`${mark}  ${result.name.padEnd(38)} ${String(result.ms).padStart(5)}ms  ${result.detail}`)
    }
    console.log(`\n${results.length - failures}/${results.length} scenarios passed`)
    process.exit(failures === 0 ? 0 : 1)
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})







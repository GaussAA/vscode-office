/**
 * Minimal Chrome DevTools Protocol driver.
 *
 * No puppeteer: the repo already needs Chrome for nothing, so the suite locates an
 * installed browser (or `CHROME_PATH`) and speaks CDP over the built-in WebSocket.
 * Node >= 22 is required for the global WebSocket.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export function findBrowser() {
    return CANDIDATES.find(candidate => candidate && existsSync(candidate)) ?? null
}

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = createServer()
        probe.on('error', reject)
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address()
            probe.close(() => resolve(port))
        })
    })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForTarget(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
            const page = list.find(target => target.type === 'page')
            if (page) return page.webSocketDebuggerUrl
        } catch {
            // browser still starting
        }
        await sleep(200)
    }
    throw new Error('Chrome DevTools endpoint did not become reachable')
}

export async function launchBrowser({ headless = true, width = 1500, height = 850 } = {}) {
    const exe = findBrowser()
    if (!exe) {
        throw new Error('No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.')
    }
    if (typeof WebSocket !== 'function') {
        throw new Error('Node >= 22 is required (global WebSocket)')
    }

    const port = await freePort()
    const userDataDir = mkdtempSync(join(tmpdir(), 'ovp-ui-'))
    const isLinux = process.platform === 'linux'
    const args = [
        headless ? '--headless=new' : '',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        // CI containers: the sandbox needs privileges the runner lacks, and /dev/shm is
        // small enough that Chrome dies before it opens the DevTools port.
        ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : []),
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${port}`,
        `--window-size=${width},${height}`,
        'about:blank',
    ].filter(Boolean)
    const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-2000)
    })

    let wsUrl
    try {
        wsUrl = await waitForTarget(port)
    } catch (error) {
        const detail = stderr.trim() ? `\nChrome stderr:\n${stderr.trim()}` : ''
        throw new Error(`${error.message}${detail}`)
    }
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let sequence = 0

    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        const slot = pending.get(message.id)
        if (!slot) return
        pending.delete(message.id)
        if (message.error) slot.reject(new Error(JSON.stringify(message.error)))
        else slot.resolve(message.result)
    })
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', reject, { once: true })
    })

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
    })

    await send('Page.enable')
    await send('Runtime.enable')

    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        })
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
        }
        return result.result?.value
    }

    return {
        send,
        evaluate,
        navigate: async url => {
            await send('Page.navigate', { url })
        },
        screenshot: async file => {
            const shot = await send('Page.captureScreenshot', { format: 'png' })
            writeFileSync(file, Buffer.from(shot.data, 'base64'))
        },
        waitFor: async (expression, timeoutMs = 8000) => {
            const deadline = Date.now() + timeoutMs
            while (Date.now() < deadline) {
                if (await evaluate(expression)) return true
                await sleep(120)
            }
            return false
        },
        sleep,
        child,
        close: async () => {
            try { socket.close() } catch { /* already closed */ }
            try { child.kill() } catch { /* already gone */ }
            // Wait for Chrome to actually exit: on Linux it keeps writing to the profile
            // for a moment, and rmSync then fails with ENOTEMPTY in the middle of a run.
            await new Promise(resolve => {
                if (child.exitCode !== null || child.signalCode !== null) return resolve()
                const timer = setTimeout(resolve, 3000)
                child.once('exit', () => {
                    clearTimeout(timer)
                    resolve()
                })
            })
            try {
                rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
            } catch {
                // a leftover profile in tmpdir is not worth failing the run for
            }
        },
    }
}




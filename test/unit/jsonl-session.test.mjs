import assert from 'node:assert/strict'
import test from 'node:test'
import { JsonlFile, memoryByteSource } from '../../out/unit-tests/jsonlFile.mjs'
import { JsonlSession } from '../../out/unit-tests/jsonlSession.mjs'

/** Build a session over literal JSONL text. */
async function makeSession(lines) {
    const bytes = new TextEncoder().encode(lines.map(line => `${line}\n`).join(''))
    return new JsonlSession(await JsonlFile.open(memoryByteSource(bytes)))
}

/** Run a scan to completion with a synchronous scheduler and collect the batches. */
async function runSearch(session, query, options = {}) {
    const batches = []
    const handle = session.search(7, query, {
        onBatch: batch => batches.push(batch),
        schedule: run => run(),
        ...options,
    })
    await handle.finished
    return batches
}

const tick = () => new Promise(resolve => setTimeout(resolve, 10))

test('readRange: echoes the request id and clamps to the file', async () => {
    const session = await makeSession(['{"id":0}', '{"id":1}', '{"id":2}'])

    const first = await session.readRange(42, 0, 2)
    assert.equal(first.requestId, 42, 'the reply must be attributable')
    assert.equal(first.start, 0)
    assert.deepEqual(first.entries.map(entry => entry.index), [0, 1])

    const past = await session.readRange(43, 2, 99)
    assert.deepEqual(past.entries.map(entry => entry.index), [2], 'end clamps to lineCount')

    const backwards = await session.readRange(44, 5, 9)
    assert.deepEqual([backwards.start, backwards.entries.length], [3, 0])
})

test('readRange: absolute line numbers survive the windowed read', async () => {
    const session = await makeSession(Array.from({ length: 40 }, (_, index) => `{"id":${index}}`))

    const payload = await session.readRange(1, 30, 35)
    assert.deepEqual(payload.entries.map(entry => entry.index), [30, 31, 32, 33, 34])
    assert.equal(payload.entries[0].label, '30')
})

test('readEntry: echoes the request id, and rejects an out-of-range line', async () => {
    const session = await makeSession(['{"id":"a","name":"first"}', '{"id":"b"}'])

    const payload = await session.readEntry(9, 0)
    assert.equal(payload.requestId, 9)
    assert.equal(payload.index, 0)
    assert.equal(payload.entry.label, 'a')

    assert.equal(await session.readEntry(10, 2), null)
    assert.equal(await session.readEntry(11, -1), null)
})

test('readEntry: works for the last line of a file without a trailing newline', async () => {
    const bytes = new TextEncoder().encode('{"id":"a"}\n{"id":"b"}')
    const session = new JsonlSession(await JsonlFile.open(memoryByteSource(bytes)))

    const payload = await session.readEntry(5, 1)
    assert.equal(payload.index, 1)
    assert.equal(payload.entry.label, 'b')
})

test('search: streams matches in batches and ends with done', async () => {
    const session = await makeSession(['{"name":"alpha"}', '{"name":"beta"}', '{"name":"alphabet"}'])

    const batches = await runSearch(session, 'alpha')

    assert.equal(batches.length, 1, 'a small file finishes in one batch')
    const [batch] = batches
    assert.equal(batch.requestId, 7)
    assert.equal(batch.query, 'alpha')
    assert.equal(batch.matches, 2)
    assert.equal(batch.done, true)
    assert.equal(batch.capped, false)
    assert.equal(batch.total, 3)
    assert.deepEqual(batch.entries.map(entry => entry.index), [0, 2])
    assert.ok(batch.entries[0].snippet.includes('alpha'), 'the snippet is centred on the match')
})

test('search: an empty query answers immediately with a finished batch', async () => {
    const session = await makeSession(['{"id":1}'])
    const batches = await runSearch(session, '   ')

    assert.equal(batches.length, 1)
    assert.equal(batches[0].done, true)
    assert.equal(batches[0].entries.length, 0)
    assert.equal(batches[0].matches, 0)
})

test('search: stops at maxMatches and says it was capped', async () => {
    const session = await makeSession(['{"n":1}', '{"n":1}', '{"n":1}'])
    const batches = await runSearch(session, 'n', { maxMatches: 1 })

    const last = batches.at(-1)
    assert.equal(last.capped, true)
    assert.equal(last.done, true)
    assert.equal(last.matches, 1)
})

test('search: a newer scan cancels the old one instead of finishing it', async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `{"id":${index}}`)
    const session = await makeSession(lines)

    const firstBatches = []
    const handle = session.search(1, 'id', {
        step: 1,
        batchSize: 1,
        onBatch: batch => firstBatches.push(batch),
        // One turn per macrotask, so the scan is genuinely mid-flight when we cancel.
        schedule: run => setTimeout(run, 0),
    })

    await tick()
    const beforeCancel = firstBatches.length
    assert.ok(beforeCancel > 0, 'the scan had started')
    assert.ok(firstBatches.at(-1).scanned < 200, 'the scan had not finished')

    handle.cancel()
    await handle.finished
    await tick()

    assert.equal(firstBatches.length, beforeCancel, 'no batch arrives after cancel()')
    assert.equal(firstBatches.at(-1).done, false, 'a cancelled scan never reports done')
    assert.equal(handle.done, true)
})

test('search: starting a second scan cancels the first one host-side', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `{"id":${index}}`)
    const session = await makeSession(lines)

    const first = []
    const firstRun = session.search(1, 'id', {
        step: 5,
        onBatch: batch => first.push(batch),
        schedule: run => queueMicrotask(run),
    })
    await tick()

    const second = []
    const secondRun = session.search(2, 'id', {
        step: 5,
        onBatch: batch => second.push(batch),
        schedule: run => queueMicrotask(run),
    })
    await secondRun.finished
    await tick()

    assert.ok(first.length > 0)
    assert.ok(second.length > 0)
    assert.ok(second.every(batch => batch.requestId === 2), 'the new scan owns the emissions')
    assert.equal(firstRun.done, true, 'the first scan stopped')
})

test('search: a scan over several steps still reports absolute line numbers', async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `{"id":${index},"tag":"hit"}`)
    const session = await makeSession(lines)

    const batches = await runSearch(session, 'hit', { step: 5 })
    const all = batches.flatMap(batch => batch.entries.map(entry => entry.index))

    assert.deepEqual(all, lines.map((_, index) => index))
    assert.equal(batches.at(-1).done, true)
})

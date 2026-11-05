import assert from 'node:assert/strict'
import test from 'node:test'
import { buildJsonlIndex } from '../../out/unit-tests/jsonlDocument.mjs'
import { JsonlSession } from '../../out/unit-tests/jsonlSession.mjs'

/** Build a session over literal JSONL text. */
function makeSession(lines) {
    const bytes = new TextEncoder().encode(lines.map(line => `${line}\n`).join(''))
    return new JsonlSession(bytes, buildJsonlIndex(bytes))
}

/** Run a scan to completion with a synchronous scheduler and collect the batches. */
function runSearch(session, query, options = {}) {
    const batches = []
    session.search(7, query, {
        onBatch: batch => batches.push(batch),
        schedule: run => run(),
        ...options,
    })
    return batches
}

test('readRange: echoes the request id and clamps to the file', () => {
    const session = makeSession(['{"id":0}', '{"id":1}', '{"id":2}'])

    const first = session.readRange(42, 0, 2)
    assert.equal(first.requestId, 42, 'the reply must be attributable')
    assert.equal(first.start, 0)
    assert.deepEqual(first.entries.map(entry => entry.index), [0, 1])

    const past = session.readRange(43, 2, 99)
    assert.deepEqual(past.entries.map(entry => entry.index), [2], 'end clamps to lineCount')

    const backwards = session.readRange(44, 5, 9)
    assert.deepEqual([backwards.start, backwards.entries.length], [3, 0])
})

test('readEntry: echoes the request id, and rejects an out-of-range line', () => {
    const session = makeSession(['{"id":"a","name":"first"}', '{"id":"b"}'])

    const payload = session.readEntry(9, 0)
    assert.equal(payload.requestId, 9)
    assert.equal(payload.index, 0)
    assert.equal(payload.entry.label, 'a')

    assert.equal(session.readEntry(10, 2), null)
    assert.equal(session.readEntry(11, -1), null)
})

test('search: streams matches in batches and ends with done', () => {
    const session = makeSession(['{"name":"alpha"}', '{"name":"beta"}', '{"name":"alphabet"}'])

    const batches = runSearch(session, 'alpha')

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

test('search: an empty query answers immediately with a finished batch', () => {
    const session = makeSession(['{"id":1}'])
    const batches = runSearch(session, '   ')

    assert.equal(batches.length, 1)
    assert.equal(batches[0].done, true)
    assert.equal(batches[0].entries.length, 0)
    assert.equal(batches[0].matches, 0)
})

test('search: stops at maxMatches and says it was capped', () => {
    const session = makeSession(['{"n":1}', '{"n":1}', '{"n":1}'])
    const batches = runSearch(session, 'n', { maxMatches: 1 })

    const last = batches.at(-1)
    assert.equal(last.capped, true)
    assert.equal(last.done, true)
    assert.equal(last.matches, 1)
})

test('search: a newer scan cancels the old one instead of finishing it', async () => {
    const lines = Array.from({ length: 50 }, (_, index) => `{"id":${index}}`)
    const session = makeSession(lines)

    const firstBatches = []
    const handle = session.search(1, 'id', {
        step: 5,
        onBatch: batch => firstBatches.push(batch),
        schedule: run => queueMicrotask(run),
    })

    await Promise.resolve()
    handle.cancel('cancelled by a newer query')
    const seenWhenCancelled = firstBatches.length
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(seenWhenCancelled >= 1, 'the scan had started')
    assert.equal(firstBatches.length, seenWhenCancelled, 'no batch arrives after cancel()')
    assert.equal(firstBatches.at(-1).done, false, 'a cancelled scan never reports done')
    assert.equal(handle.done, true)
})

test('search: starting a second scan cancels the first one host-side', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `{"id":${index}}`)
    const session = makeSession(lines)

    const first = []
    session.search(1, 'id', {
        step: 5,
        onBatch: batch => first.push(batch),
        schedule: run => queueMicrotask(run),
    })
    await Promise.resolve()

    const second = []
    session.search(2, 'id', {
        step: 5,
        onBatch: batch => second.push(batch),
        schedule: run => queueMicrotask(run),
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(first.every(batch => batch.requestId === 1))
    assert.ok(second.length > 0)
    assert.ok(second.every(batch => batch.requestId === 2), 'the new scan owns the emissions')
})

test('reload: swaps the bytes and cancels any running scan', async () => {
    const session = makeSession(['{"id":"old"}'])
    const batches = []
    session.search(3, 'old', {
        step: 1,
        onBatch: batch => batches.push(batch),
        schedule: run => queueMicrotask(run),
    })

    const replacement = new TextEncoder().encode('{"id":"new"}\n{"id":"new2"}\n')
    session.reload(replacement, buildJsonlIndex(replacement))
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(session.lineCount, 2)
    assert.equal(batches.length, 0, 'the pre-reload scan must not emit into the new file')
    assert.equal(session.readEntry(4, 0).entry.label, 'new')
})

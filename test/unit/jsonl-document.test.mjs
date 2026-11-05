import assert from 'node:assert/strict'
import test from 'node:test'
import {
    buildJsonlIndex,
    deriveLabel,
    matchSnippet,
    readJsonlLineText,
} from '../../out/unit-tests/jsonlDocument.mjs'

const encoder = new TextEncoder()

function open(text) {
    const bytes = encoder.encode(text)
    return { bytes, index: buildJsonlIndex(bytes) }
}

test('index: splits lines and treats a trailing newline as a terminator', () => {
    const plain = open('a\nb\nc')
    assert.equal(plain.index.lineCount, 3)
    assert.equal(readJsonlLineText(plain.bytes, plain.index, 0).text, 'a')
    assert.equal(readJsonlLineText(plain.bytes, plain.index, 2).text, 'c')

    const trailing = open('a\nb\n')
    // 'a' and 'b' only: the final newline terminates the last line, it does not start a new one.
    assert.equal(trailing.index.lineCount, 2)
    assert.equal(readJsonlLineText(trailing.bytes, trailing.index, 1).text, 'b')
})

test('index: an empty file still exposes one line', () => {
    const empty = open('')
    assert.equal(empty.index.lineCount, 1)
    assert.equal(readJsonlLineText(empty.bytes, empty.index, 0).text, '')
})

test('read: strips a CRLF terminator from the decoded text', () => {
    const crlf = open('{"a":1}\r\n{"b":2}\n')
    assert.equal(crlf.index.lineCount, 2)
    assert.equal(readJsonlLineText(crlf.bytes, crlf.index, 0).text, '{"a":1}')
    assert.equal(readJsonlLineText(crlf.bytes, crlf.index, 1).text, '{"b":2}')
})

test('label: derives identity from configured top-level keys only', () => {
    assert.equal(deriveLabel({ id: 42 }), '42')
    assert.equal(deriveLabel({ name: '  alpha  ' }), 'alpha')
    assert.equal(deriveLabel({ _id: 'abc123' }), 'abc123')
    assert.equal(deriveLabel({ timestamp: 1700000000 }), '1700000000')
    assert.equal(deriveLabel({ nested: { id: 1 } }), undefined, 'nested ids are not identity')
    assert.equal(deriveLabel({ id: {}, name: 'beta' }), 'beta', 'an unusable key falls through')
    assert.equal(deriveLabel('scalar'), undefined)
})

test('label: truncates long values to 40 characters plus an ellipsis', () => {
    const label = deriveLabel({ name: 'x'.repeat(60) })
    assert.equal(label.length, 41)
    assert.ok(label.endsWith('…'))
})

test('snippet: keeps short text intact and marks a window in long text', () => {
    assert.equal(matchSnippet('abcdefghij', 'def'), 'abcdefghij')
    assert.equal(matchSnippet('no hit here', 'zzz'), undefined)

    const long = `${'x'.repeat(100)}needle${'y'.repeat(100)}`
    const snippet = matchSnippet(long, 'needle', 5)
    assert.ok(snippet.startsWith('…'), 'text before the window is elided')
    assert.ok(snippet.endsWith('…'), 'text after the window is elided')
    assert.ok(snippet.includes('needle'))
    assert.equal(snippet.length, 2 + 5 + 6 + 5, 'caller radius is honoured')
})

test('snippet: matching is case-insensitive against the text', () => {
    const text = 'ABC'.repeat(40) + 'NEEDLE'
    const snippet = matchSnippet(text, 'needle', 3)
    assert.ok(snippet.includes('NEEDLE'))
    assert.ok(snippet.startsWith('…'))
})


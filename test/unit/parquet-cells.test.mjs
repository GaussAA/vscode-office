import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCellValue, parseCellInput } from '../../out/unit-tests/parquetParser.mjs'

test('formatCellValue: null and undefined render as empty, not "null"', () => {
    assert.equal(formatCellValue(null), '')
    assert.equal(formatCellValue(undefined), '')
})

test('formatCellValue: keeps precision for bigint and ISO for dates', () => {
    assert.equal(formatCellValue(9007199254740993n), '9007199254740993')
    assert.equal(formatCellValue(new Date('2026-11-05T00:00:00Z')), '2026-11-05T00:00:00.000Z')
})

test('formatCellValue: serialises objects and stringifies scalars', () => {
    assert.equal(formatCellValue({ a: 1 }), '{"a":1}')
    assert.equal(formatCellValue([1, 2]), '[1,2]')
    assert.equal(formatCellValue(true), 'true')
    assert.equal(formatCellValue(3.5), '3.5')
})

test('parseCellInput: empty input clears the cell', () => {
    assert.equal(parseCellInput('', 'INT32'), null)
    assert.equal(parseCellInput('   ', 'STRING'), null)
})

test('parseCellInput: integer columns truncate', () => {
    assert.equal(parseCellInput('42', 'INT32'), 42)
    assert.equal(parseCellInput(' 3.9 ', 'INT64'), 3)
    assert.equal(parseCellInput('-7', 'INT32'), -7)
})

test('parseCellInput: floating columns keep the fraction', () => {
    assert.equal(parseCellInput('3.9', 'DOUBLE'), 3.9)
    assert.equal(parseCellInput('1e3', 'FLOAT'), 1000)
})

test('parseCellInput: boolean columns accept common spellings', () => {
    assert.equal(parseCellInput('true', 'BOOLEAN'), true)
    assert.equal(parseCellInput('yes', 'BOOLEAN'), true)
    assert.equal(parseCellInput('0', 'BOOLEAN'), false)
    assert.equal(parseCellInput('maybe', 'BOOLEAN'), 'maybe', 'unknown words are kept verbatim')
})

test('parseCellInput: unparsable numbers fall back to the raw text', () => {
    assert.equal(parseCellInput('abc', 'INT32'), 'abc')
    assert.equal(parseCellInput('12abc', 'DOUBLE'), '12abc')
})

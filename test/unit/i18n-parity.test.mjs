import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as catalog from '../../out/unit-tests/i18nCatalog.mjs'

/**
 * The message catalog is the one place a user-visible string is allowed to live, and there
 * are ten of them. Nothing checked that they agreed, so nine `parquet.*` keys existed in
 * English only and every non-English user silently fell back — for the fork's headline
 * feature. These tests make that a red build.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

const LOCALES = {
    en: catalog.en,
    'zh-cn': catalog.zhCn,
    'zh-tw': catalog.zhTw,
    ja: catalog.ja,
    de: catalog.de,
    fr: catalog.fr,
    es: catalog.es,
    'pt-br': catalog.ptBr,
    ko: catalog.ko,
    ru: catalog.ru,
}

/**
 * Known translation debt, per locale. The number may only go down: adding an English string
 * without translating it raises this budget, which is exactly the kind of change that should
 * be a conscious decision rather than a silent fallback.
 *
 * The 56 keys below are the `parquet` chrome and the whole `jsonl` viewer. Translating them
 * into seven languages is a job for a native speaker, not a commit hook; until then the
 * English fallback is correct but unlocalised, and this budget keeps the gap from growing.
 */
const MAX_MISSING = {
    'zh-cn': 0,
    'zh-tw': 0,
    ja: 56,
    de: 56,
    fr: 56,
    es: 56,
    'pt-br': 56,
    ko: 56,
    ru: 56,
}

function flatten(tree, prefix = '') {
    const out = new Map()
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object') {
            for (const [nested, text] of flatten(value, path)) out.set(nested, text)
        } else {
            out.set(path, value)
        }
    }
    return out
}

function walk(dir, extensions) {
    const out = []
    for (const entry of readdirSync(join(root, dir))) {
        const path = join(dir, entry)
        if (statSync(join(root, path)).isDirectory()) out.push(...walk(path, extensions))
        else if (extensions.some(extension => path.endsWith(extension))) out.push(path)
    }
    return out
}

const flat = Object.fromEntries(
    Object.entries(LOCALES).map(([locale, tree]) => [locale, flatten(tree)]),
)

test('every locale has the same keys as English, up to the recorded debt', () => {
    const english = new Set(flat.en.keys())
    const report = []
    for (const [locale, messages] of Object.entries(flat)) {
        if (locale === 'en') continue
        const missing = [...english].filter(key => !messages.has(key))
        report.push(`${locale}: ${missing.length} missing`)
        assert.ok(
            missing.length <= MAX_MISSING[locale],
            `${locale} is missing ${missing.length} key(s), budget is ${MAX_MISSING[locale]}: ${missing.slice(0, 8).join(', ')}`,
        )
    }
    assert.ok(report.length === 9)
})

test('no locale carries keys English does not have', () => {
    const english = new Set(flat.en.keys())
    for (const [locale, messages] of Object.entries(flat)) {
        const stale = [...messages.keys()].filter(key => !english.has(key))
        assert.deepEqual(stale, [], `${locale} has keys nobody can look up`)
    }
})

test('every key used in the webview exists in English', () => {
    const english = flat.en
    const files = walk('src/react', ['.ts', '.tsx'])
    const used = new Map()
    for (const file of files) {
        const text = readFileSync(join(root, file), 'utf8')
        for (const match of text.matchAll(/\$t\(\s*['"]([^'"]+)['"]/g)) {
            used.set(match[1], file)
        }
    }
    assert.ok(used.size > 50, 'the scan should find the existing call sites')

    const unknown = [...used].filter(([key]) => !english.has(key))
    assert.deepEqual(
        unknown.map(([key, file]) => `${key} (${file})`),
        [],
        'a $t() key with no English message renders the key itself to the user',
    )
})

test('no message is an empty string', () => {
    const empty = []
    for (const [locale, messages] of Object.entries(flat)) {
        for (const [key, value] of messages) {
            if (typeof value !== 'string' || value.trim() === '') empty.push(`${locale}: ${key}`)
        }
    }
    assert.deepEqual(empty, [])
})

test('placeholders survive translation', () => {
    // A translation that drops or renames {count} renders a literal brace group to the user.
    const placeholders = text => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]))
    const problems = []
    for (const [locale, messages] of Object.entries(flat)) {
        if (locale === 'en') continue
        for (const [key, value] of messages) {
            const expected = placeholders(flat.en.get(key) ?? '')
            const actual = placeholders(value)
            for (const name of expected) {
                if (!actual.has(name)) problems.push(`${locale} ${key}: missing {${name}}`)
            }
        }
    }
    assert.deepEqual(problems, [])
})

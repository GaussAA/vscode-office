import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Registration has several touch points and nothing used to check that they agree, so
 * drifts shipped unnoticed: a provider registered for a viewType nobody contributes, a
 * React route missing from the smoke list, and a duplicated file pattern. These tests turn
 * that silence into a red build.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const read = path => readFileSync(join(root, path), 'utf8')

function walk(dir, extensions) {
    const out = []
    for (const entry of readdirSync(join(root, dir))) {
        const path = join(dir, entry)
        if (statSync(join(root, path)).isDirectory()) out.push(...walk(path, extensions))
        else if (extensions.some(extension => path.endsWith(extension))) out.push(path)
    }
    return out
}

/** `registerCustomEditorProvider('<viewType>'` anywhere in a file. */
function literalViewTypes(text) {
    return [...text.matchAll(/registerCustomEditorProvider\(\s*['"]([^'"]+)['"]/g)].map(match => match[1])
}

/** The desktop-only list the web entry re-registers as an "unsupported" screen. */
function unsupportedViewTypes(text) {
    const block = /WEB_UNSUPPORTED_VIEW_TYPES\s*=\s*\[([\s\S]*?)\]/.exec(text)
    if (!block) return []
    return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1])
}

const providerFiles = walk('src/provider', ['.ts'])
const providerTypes = new Set()
for (const file of providerFiles) {
    const text = read(file)
    for (const type of literalViewTypes(text)) providerTypes.add(type)
    for (const type of unsupportedViewTypes(text)) providerTypes.add(type)
}

/** viewTypes the given entry point registers, following `x.bindCustomEditors(...)` one hop. */
function registeredBy(entryFile) {
    const text = read(entryFile)
    const types = new Set(literalViewTypes(text))

    for (const match of text.matchAll(/(\w+)\.bindCustomEditors?\(/g)) {
        const variable = match[1]
        const ctor = new RegExp(`const ${variable}\\s*=\\s*new\\s+(\\w+)`).exec(text)
        if (!ctor) continue
        const className = ctor[1]
        const file = providerFiles.find(candidate => read(candidate).includes(`class ${className}`))
        assert.ok(file, `${entryFile} binds ${variable} (${className}) but no provider file declares it`)
        const providerText = read(file)
        for (const type of literalViewTypes(providerText)) types.add(type)
        for (const type of unsupportedViewTypes(providerText)) types.add(type)
    }
    return types
}

test('every contributed custom editor is registered somewhere', () => {
    const pkg = JSON.parse(read('package.json'))
    const contributed = pkg.contributes.customEditors.map(editor => editor.viewType)
    const desktop = registeredBy('src/extension.ts')
    const missing = contributed.filter(type => !desktop.has(type))
    assert.deepEqual(missing, [], 'a contribution with no provider is an editor that opens to nothing')
})

test('every registered provider is contributed', () => {
    const pkg = JSON.parse(read('package.json'))
    const contributed = new Set(pkg.contributes.customEditors.map(editor => editor.viewType))
    const invisible = [...providerTypes].filter(type => !contributed.has(type))
    assert.deepEqual(invisible, [], 'a registered viewType nobody contributes is unreachable from the UI')
})

test('no viewType declares the same file pattern twice', () => {
    const pkg = JSON.parse(read('package.json'))
    const duplicates = []
    for (const editor of pkg.contributes.customEditors) {
        const patterns = editor.selector.flatMap(selector =>
            String(selector.filenamePattern ?? '').split(',').map(pattern => pattern.trim()),
        )
        const seen = new Set()
        for (const pattern of patterns) {
            if (!pattern) continue
            if (seen.has(pattern)) duplicates.push(`${editor.viewType}: ${pattern}`)
            seen.add(pattern)
        }
    }
    assert.deepEqual(duplicates, [])
})

test('every React route is covered by the smoke list or a dedicated scenario', () => {
    const mainRouteText = read('src/react/main.tsx')
    const routes = [...mainRouteText.matchAll(/case '([^']+)':/g)].map(match => match[1])
    assert.ok(routes.length >= 10, 'the route switch should still have its cases')

    const runner = read('scripts/ui-verify/runner.mjs')
    const smokeBlock = /const routes = \[([\s\S]*?)\]/.exec(runner)
    assert.ok(smokeBlock, 'the smoke scenario should build its routes from a literal array')
    const smoked = new Set([...smokeBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]))

    // Routes that get their own scenario instead of the mount-only smoke.
    const dedicated = {
        parquet: 'parquet-paging',
        jsonl: 'jsonl-directory',
    }

    const uncovered = routes.filter(route => {
        if (smoked.has(route)) return false
        const scenario = dedicated[route]
        return !(scenario && runner.includes(`name: '${scenario}'`))
    })

    assert.deepEqual(
        uncovered,
        [],
        'add the route to the smoke list, or give it a scenario and list it in `dedicated`',
    )
})

test('the smoke list names routes that actually exist', () => {
    const runner = read('scripts/ui-verify/runner.mjs')
    const smokeBlock = /const routes = \[([\s\S]*?)\]/.exec(runner)
    const smoked = [...smokeBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1])
    const known = new Set([...read('src/react/main.tsx').matchAll(/case '([^']+)':/g)].map(match => match[1]))
    const unknown = smoked.filter(route => !known.has(route))
    assert.deepEqual(unknown, [], 'a smoke route that main.tsx does not handle can never mount')
})

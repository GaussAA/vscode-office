import assert from 'node:assert/strict'
import test from 'node:test'
import {
    MAX_CHILDREN,
    MAX_DEPTH,
    buildTree,
    countNodes,
    highlightParts,
    makePathKey,
} from '../../out/unit-tests/jsonlFormat.mjs'

const objectOfSize = size => Object.fromEntries(
    Array.from({ length: size }, (_, index) => [`key_${index}`, index]),
)

function maxDepth(nodes, depth = 1) {
    let deepest = depth
    for (const node of nodes) {
        if (!node.children?.length) continue
        deepest = Math.max(deepest, maxDepth(node.children, depth + 1))
    }
    return deepest
}

test('countNodes: exactly the limit still fits, one more does not', () => {
    assert.equal(countNodes(objectOfSize(500)), 500)
    // Regression: returning exactly `limit` here made a 501-node entry look wrappable.
    assert.equal(countNodes(objectOfSize(501)), 501, 'crossing the cap must be reported as limit + 1')
})

test('countNodes: stops descending at MAX_DEPTH', () => {
    // A chain deeper than MAX_DEPTH can never produce a node beyond MAX_DEPTH - 1.
    let chain = { leaf: 1 }
    for (let depth = 0; depth < MAX_DEPTH + 5; depth++) chain = { child: chain }
    assert.ok(countNodes(chain) <= MAX_DEPTH)
})

test('buildTree: caps children and appends a non-selectable "more keys" row', () => {
    const built = buildTree(objectOfSize(MAX_CHILDREN + 20))
    assert.equal(built.count, MAX_CHILDREN)
    assert.equal(built.nodes.length, MAX_CHILDREN + 1)
    const more = built.nodes[built.nodes.length - 1]
    assert.equal(more.selectable, false)
    assert.equal(more.isLeaf, true)
})

test('buildTree: keeps the tree inside MAX_DEPTH', () => {
    let chain = { leaf: 1 }
    for (let depth = 0; depth < MAX_DEPTH + 5; depth++) chain = { child: chain }
    const built = buildTree(chain)
    assert.ok(built.count > 0)
    // walk() stops once the path reaches MAX_DEPTH, so the deepest node sits AT that depth.
    assert.equal(maxDepth(built.nodes), MAX_DEPTH)
    assert.ok(built.count <= MAX_DEPTH)
    assert.equal(built.allKeys.length, built.count)
})

test('buildTree: a scalar entry produces no rows', () => {
    const built = buildTree('just a string')
    assert.equal(built.nodes.length, 0)
    assert.equal(built.count, 0)
    assert.equal(built.truncated, false)
})

test('buildTree: shallowKeys stop at the default expand depth', () => {
    const built = buildTree({ a: { b: { c: { d: { e: 1 } } } } })
    // Keys are JSON arrays (makePathKey), not dotted paths.
    assert.equal(built.shallowKeys.length, 2)
    assert.ok(built.shallowKeys.includes(makePathKey(['a'])))
    assert.ok(!built.shallowKeys.includes(makePathKey(['a', 'b', 'c'])))
})

test('highlightParts: splits only the matched runs and is case-insensitive', () => {
    const parts = highlightParts('Alpha alPHA omega', 'alpha')
    assert.equal(parts.filter(part => part.hit).length, 2)
    assert.equal(parts.map(part => part.text).join(''), 'Alpha alPHA omega')
    assert.deepEqual(highlightParts('plain', ''), [{ text: 'plain', hit: false }])
})

test('highlightParts: caps the number of runs on pathological input', () => {
    const parts = highlightParts('a'.repeat(500), 'a')
    assert.ok(parts.length <= 41, `produced ${parts.length} runs`)
    assert.equal(parts.map(part => part.text).join('').length, 500)
})


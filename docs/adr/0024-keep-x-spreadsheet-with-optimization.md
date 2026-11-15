# ADR 0024: Keep x-spreadsheet with Optimization

**Status**: Accepted  
**Date**: 2024-11-15  
**Deciders**: Development Team  
**Related**: [ADR-0015](0015-narrow-to-three-viewers.md)

## Context

After comprehensive research into x-spreadsheet alternatives (fortune-sheet, wolf-table), we faced a decision: migrate to a new library or optimize the existing x-spreadsheet integration.

### Research Findings

**fortune-sheet**:

- ❌ 20MB+ bundle size (vs current 2-3MB)
- ❌ Canvas-only rendering (accessibility concerns)
- ❌ Heavy migration cost (complete rewrite needed)
- ✅ Active maintenance
- ✅ Rich features

**wolf-table**:

- ❌ Abandoned (last commit 3+ years ago)
- ❌ Limited TypeScript support
- ❌ Smaller community

**x-spreadsheet** (current):

- ✅ Already integrated and working
- ✅ Reasonable bundle size (~2-3MB)
- ✅ DOM-based rendering (better for VS Code webview)
- ✅ Meets current requirements
- ❌ Not actively maintained
- ❌ Technical debt exists

### The Decision Point

The core question: Is the migration ROI worth it?

**Migration Cost**:

- 5-10 days development
- Complete rewrite of Excel viewer
- New bug surface
- Compatibility testing
- User retraining (if UI changes significantly)

**Optimization Cost**:

- 3-5 days development
- Incremental improvements
- Lower risk
- Existing code knowledge

## Decision

**We decided to keep x-spreadsheet and optimize it locally.**

This is a pragmatic choice based on:

1. **Risk/Reward**: Optimization has much lower risk than migration
2. **Time Investment**: 3-5 days vs 5-10 days
3. **Current State**: x-spreadsheet works well enough
4. **Bundle Size**: Already acceptable (unlike fortune-sheet's 20MB+)
5. **Rendering**: DOM-based is better for VS Code webview

## Optimization Strategy

Instead of migrating, we invest 3-5 days in targeted optimizations:

### Day 1-2: Dead Code Removal ✅ COMPLETED

- Remove Chart functionality (empty implementation)
- Remove Print functionality (not needed in VS Code)
- Remove unused locales (de, nl)
- **Result**: 519 lines removed (3.8% reduction)

### Day 3: Bundle Size Optimization (PARTLY SHIPPED)

- Bundle analysis with rollup-plugin-visualizer
- Lazy-load locale files (not shipped; locales are static imports)
- Lazy-load modal components (shipped: Find/Replace, Save As)
- Tree-shake unused SVG icons

### Day 4: Performance Optimization (SHIPPED: listener cleanup)

- Event listener cleanup (prevent memory leaks)
- Rendering optimizations
- Profiling large files

### Day 5: Documentation (PLANNED)

- Maintenance guide
- Bug fix guide
- Future migration considerations

## Consequences

### Positive

1. **Low Risk**: Incremental changes, each tested independently
2. **Cost Effective**: 3-5 days vs 5-10 days for migration
3. **Immediate Value**: Each optimization improves current state
4. **Reversible**: Git makes it easy to roll back if needed
5. **Learning**: Better understanding of x-spreadsheet internals

### Negative

1. **Technical Debt**: We accept that x-spreadsheet is not actively maintained
2. **No New Features**: Optimization doesn't add features fortune-sheet has
3. **Future Migration**: Still an option if requirements change significantly
4. **Maintenance Burden**: We own any future bug fixes

### Neutral

1. **Not Forever**: This decision can be revisited in 6-12 months
2. **Documented Path**: We now have clear migration research if needed
3. **Reduced Scope**: Each optimization makes potential future migration easier

## Success Criteria

Optimization succeeds if we achieve:

- ✅ 10-20% code reduction (Target: ~1,400-2,800 lines)
- ⏳ 50-100KB bundle size reduction
- ⏳ 20%+ performance improvement (or no bottlenecks found)
- ⏳ All tests passing
- ⏳ Zero functionality loss
- ⏳ Complete documentation

**Current Progress**: Day 2 complete, 519 lines removed (3.8%)

## When to Reconsider

We should revisit this decision if:

1. **New Requirements**: Need features only fortune-sheet provides
2. **Maintenance Crisis**: Critical x-spreadsheet bugs we can't fix
3. **Bundle Bloat**: Size grows beyond acceptable limits
4. **Performance Wall**: Hit optimization limits
5. **Accessibility Requirements**: Need features x-spreadsheet can't provide

## References

- [fortune-sheet Assessment](../fortunesheet-quick-assessment.md)
- [wolf-table Assessment](../wolf-table-assessment.md)
- [Optimization Plan](../x-spreadsheet-optimization-plan.md)
- [Optimization Progress](../x-spreadsheet-optimization-progress.md)

## Notes

This ADR represents a **pragmatic engineering decision**: optimize what we have rather than chasing a potentially better but riskier alternative.

The key insight: x-spreadsheet's technical debt is manageable, and the migration cost doesn't justify the benefits given current requirements.

If future requirements change significantly (e.g., need collaborative editing, advanced charting, or massive file support), fortune-sheet becomes the obvious choice. But for our current needs, local optimization is the better investment.

import { Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { JsonlEntrySummary } from '../../../common/jsonlTypes.ts';
import { ROW_HEIGHT, formatBytes } from './jsonlFormat.tsx';

interface Props {
    /** Ordered rows: a contiguous window in directory mode, the matches in search mode. */
    items: JsonlEntrySummary[];
    selected: number;
    /** True while a chunk (or a search) is in flight. */
    loading: boolean;
    onSelect: (index: number) => void;
    /** Undefined in search mode — there is nothing more to load. */
    onNeedMore?: () => void;
    header?: ReactNode;
    emptyText?: string;
}

const PAGE_STEP = 10;

/** Left pane: the directory of entries. One line = one row, never nested. */
export default function JsonlIndex({
    items,
    selected,
    loading,
    onSelect,
    onNeedMore,
    header,
    emptyText = 'No entries',
}: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = useState(320);

    const holder = useCallback((): HTMLElement | null => {
        return containerRef.current?.querySelector<HTMLElement>('.ant-tree-list-holder') ?? null;
    }, []);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHeight(Math.max(120, element.clientHeight)));
        observer.observe(element);
        setHeight(Math.max(120, element.clientHeight));
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const element = holder();
        if (!element || !onNeedMore) return;
        const onScroll = () => {
            const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
            if (remaining < 400 && !loading) onNeedMore();
        };
        element.addEventListener('scroll', onScroll, { passive: true });
        return () => element.removeEventListener('scroll', onScroll);
    }, [holder, loading, onNeedMore]);

    const positionOf = useMemo(() => {
        const map = new Map<number, number>();
        items.forEach((entry, position) => map.set(entry.index, position));
        return map;
    }, [items]);

    // keep the selected entry visible
    useEffect(() => {
        const element = holder();
        const position = positionOf.get(selected);
        if (!element || position === undefined) return;
        const top = position * ROW_HEIGHT;
        const viewTop = element.scrollTop;
        const viewBottom = viewTop + element.clientHeight;
        if (top < viewTop || top + ROW_HEIGHT > viewBottom) {
            element.scrollTop = Math.max(0, top - element.clientHeight / 2);
        }
    }, [holder, selected, positionOf]);

    const treeData = useMemo<DataNode[]>(() => {
        return items.map(entry => {
            const index = entry.index;
            let title: ReactNode;
            if (entry.empty) {
                title = (
                    <span className="jsonl-entry">
                        <span className="jsonl-lineno">{index + 1}</span>
                        <span className="jsonl-type">empty</span>
                    </span>
                );
            } else if (entry.error) {
                title = (
                    <span className="jsonl-entry">
                        <span className="jsonl-lineno">{index + 1}</span>
                        <span className="jsonl-chip jsonl-chip--error">invalid</span>
                        <span className="jsonl-entry__raw jsonl-entry__raw--error">{entry.raw}</span>
                    </span>
                );
            } else if (entry.tooLarge) {
                title = (
                    <span className="jsonl-entry">
                        <span className="jsonl-lineno">{index + 1}</span>
                        <span className="jsonl-chip jsonl-chip--warn">too large</span>
                        <span className="jsonl-muted">{formatBytes(entry.size)}</span>
                    </span>
                );
            } else {
                title = (
                    <span className="jsonl-entry">
                        <span className="jsonl-lineno">{index + 1}</span>
                        {entry.label !== undefined && <span className="jsonl-entry__label">{entry.label}</span>}
                        <span className="jsonl-entry__raw">{entry.raw}</span>
                    </span>
                );
            }
            return { key: String(index), title, isLeaf: true };
        });
    }, [items]);

    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        const position = positionOf.get(selected) ?? 0;
        let nextPosition: number | null = null;
        switch (event.key) {
            case 'ArrowDown': nextPosition = position + 1; break;
            case 'ArrowUp': nextPosition = position - 1; break;
            case 'PageDown': nextPosition = position + PAGE_STEP; break;
            case 'PageUp': nextPosition = position - PAGE_STEP; break;
            case 'Home': nextPosition = 0; break;
            case 'End': nextPosition = items.length - 1; break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        const clamped = Math.max(0, Math.min(items.length - 1, nextPosition));
        const next = items[clamped];
        if (next && next.index !== selected) onSelect(next.index);
    }, [items, positionOf, selected, onSelect]);

    return (
        <div className="jsonl-index" ref={containerRef}>
            {header}
            {items.length === 0 ? (
                <div className="jsonl-empty">{emptyText}</div>
            ) : (
                <Tree
                    className="jsonl-index__tree"
                    treeData={treeData}
                    selectedKeys={[String(selected)]}
                    onSelect={keys => {
                        const key = keys[0];
                        if (key !== undefined) onSelect(Number(key));
                    }}
                    height={height - (header ? 26 : 0)}
                    itemHeight={ROW_HEIGHT}
                    virtual
                    showIcon={false}
                />
            )}
        </div>
    );
}

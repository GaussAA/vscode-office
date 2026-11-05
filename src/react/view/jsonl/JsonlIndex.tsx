import { Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonlEntrySummary } from '../../../common/jsonlTypes.ts';
import { ROW_HEIGHT, formatBytes } from './jsonlFormat.tsx';

interface Props {
    entries: Map<number, JsonlEntrySummary>;
    loadedStart: number;
    loadedEnd: number;
    lineCount: number;
    selected: number;
    loading: boolean;
    onSelect: (index: number) => void;
    onNeedMore: () => void;
}

const PAGE_STEP = 10;

/** Left pane: the directory of entries. One line = one row, never nested. */
export default function JsonlIndex({
    entries,
    loadedStart,
    loadedEnd,
    lineCount,
    selected,
    loading,
    onSelect,
    onNeedMore,
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
        if (!element) return;
        const onScroll = () => {
            const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
            if (remaining < 400 && loadedEnd < lineCount && !loading) {
                onNeedMore();
            }
        };
        element.addEventListener('scroll', onScroll, { passive: true });
        return () => element.removeEventListener('scroll', onScroll);
    }, [holder, loadedEnd, lineCount, loading, onNeedMore]);

    // keep the selected entry visible
    useEffect(() => {
        const element = holder();
        if (!element) return;
        if (selected < loadedStart || selected >= loadedEnd) return;
        const top = (selected - loadedStart) * ROW_HEIGHT;
        const viewTop = element.scrollTop;
        const viewBottom = viewTop + element.clientHeight;
        if (top < viewTop || top + ROW_HEIGHT > viewBottom) {
            element.scrollTop = Math.max(0, top - element.clientHeight / 2);
        }
    }, [holder, selected, loadedStart, loadedEnd]);

    const treeData = useMemo<DataNode[]>(() => {
        const nodes: DataNode[] = [];
        for (let index = loadedStart; index < loadedEnd; index++) {
            const entry = entries.get(index);
            let title: React.ReactNode;
            if (!entry) {
                title = (
                    <span className="jsonl-entry">
                        <span className="jsonl-lineno">{index + 1}</span>
                        <span className="jsonl-muted">loading…</span>
                    </span>
                );
            } else if (entry.empty) {
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
            nodes.push({ key: String(index), title, isLeaf: true });
        }
        return nodes;
    }, [entries, loadedStart, loadedEnd]);

    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        let next: number | null = null;
        switch (event.key) {
            case 'ArrowDown': next = selected + 1; break;
            case 'ArrowUp': next = selected - 1; break;
            case 'PageDown': next = selected + PAGE_STEP; break;
            case 'PageUp': next = selected - PAGE_STEP; break;
            case 'Home': next = 0; break;
            case 'End': next = lineCount - 1; break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        const clamped = Math.max(0, Math.min(lineCount - 1, next));
        if (clamped !== selected) onSelect(clamped);
    }, [selected, lineCount, onSelect]);

    return (
        <div className="jsonl-index" ref={containerRef} onKeyDownCapture={onKeyDown}>
            <Tree
                className="jsonl-index__tree"
                treeData={treeData}
                selectedKeys={[String(selected)]}
                onSelect={keys => {
                    const key = keys[0];
                    if (key !== undefined) onSelect(Number(key));
                }}
                height={height}
                itemHeight={ROW_HEIGHT}
                virtual
                showIcon={false}
            />
        </div>
    );
}

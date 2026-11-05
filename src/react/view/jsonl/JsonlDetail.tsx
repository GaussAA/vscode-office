import { CopyOutlined } from '@ant-design/icons';
import { $t } from '../../i18n/i18nConfig.ts';
import { Button, Modal, Segmented, Tree } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonlEntryDetail } from '../../../common/jsonlTypes.ts';
import {
    AUTO_EXPAND_LIMIT,
    EXPAND_ALL_CONFIRM,
    ROW_HEIGHT,
    WRAP_NODE_LIMIT,
    buildTree,
    countNodes,
    formatBytes,
    isComposite,
    pathToText,
    preview,
    readPathKey,
    typeLabel,
    valueAtPath,
} from './jsonlFormat.tsx';

export type DetailMode = 'tree' | 'raw';

interface Props {
    index: number;
    entry: JsonlEntryDetail | null;
    loading: boolean;
    mode: DetailMode;
    onModeChange: (mode: DetailMode) => void;
}

function jsonText(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return String(value);
    }
}

/** Right pane: the full tree (or raw text) of exactly one entry. */
export default function JsonlDetail({ index, entry, loading, mode, onModeChange }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = useState(320);
    /**
     * null means "follow the default expansion for this entry"; the first toggle pins an
     * explicit set. The pane is keyed by entry index, so switching entries remounts it and
     * both this and `activeKey` fall back to their defaults.
     */
    const [expanded, setExpanded] = useState<React.Key[] | null>(null);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [copied, setCopied] = useState<'value' | 'path' | null>(null);

    // Small entries get wrapping (variable row height => no virtual scrolling);
    // big ones stay single-line so the tree keeps its fixed-height virtual list.
    const wrap = useMemo(() => {
        if (!entry || entry.value === undefined) return false;
        return countNodes(entry.value) <= WRAP_NODE_LIMIT;
    }, [entry]);

    const built = useMemo(() => {
        if (!entry || entry.value === undefined) return null;
        return buildTree(entry.value, wrap);
    }, [entry, wrap]);

    const defaultExpanded = useMemo<React.Key[]>(() => {
        if (!built) return [];
        return built.count <= AUTO_EXPAND_LIMIT ? built.allKeys : built.shallowKeys;
    }, [built]);
    const expandedKeys = expanded ?? defaultExpanded;

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHeight(Math.max(120, element.clientHeight)));
        observer.observe(element);
        setHeight(Math.max(120, element.clientHeight));
        return () => observer.disconnect();
    }, []);

    const flash = useCallback((kind: 'value' | 'path') => {
        setCopied(kind);
        window.setTimeout(() => setCopied(null), 1200);
    }, []);

    const copy = useCallback(async (text: string, kind: 'value' | 'path') => {
        try {
            await navigator.clipboard.writeText(text);
            flash(kind);
        } catch {
            // clipboard unavailable; ignore
        }
    }, [flash]);

    const activeValue = useCallback(() => {
        if (!entry) return undefined;
        if (!activeKey) return entry.value;
        const path = readPathKey(activeKey);
        return valueAtPath(entry.value, path);
    }, [entry, activeKey]);

    const copyValue = useCallback(() => {
        if (!entry) return;
        void copy(jsonText(activeValue()), 'value');
    }, [entry, activeValue, copy]);

    const copyPath = useCallback(() => {
        if (!entry) return;
        const text = activeKey
            ? `L${index + 1} › ${pathToText(readPathKey(activeKey))}`
            : `L${index + 1}`;
        void copy(text, 'path');
    }, [entry, activeKey, index, copy]);

    const expandAll = useCallback(() => {
        if (!built) return;
        if (built.count > EXPAND_ALL_CONFIRM) {
            Modal.confirm({
                title: $t('jsonl.expandAllConfirmTitle'),
                content: $t('jsonl.expandAllConfirmBody', { count: `${built.count}${built.truncated ? '+' : ''}` }),
                okText: $t('jsonl.expandAll'),
                cancelText: $t('common.cancel'),
                onOk: () => setExpanded(built.allKeys),
            });
            return;
        }
        setExpanded(built.allKeys);
    }, [built]);

    const collapseAll = useCallback(() => setExpanded([]), []);

    const mutateExpansion = useCallback((update: (keys: React.Key[]) => React.Key[]) => {
        setExpanded(update(expandedKeys));
    }, [expandedKeys]);

    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (activeKey) {
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                mutateExpansion(keys => (keys.includes(activeKey) ? keys : [...keys, activeKey]));
                return;
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                mutateExpansion(keys => keys.filter(key => key !== activeKey));
                return;
            }
            if (event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                mutateExpansion(keys => (keys.includes(activeKey) ? keys.filter(key => key !== activeKey) : [...keys, activeKey]));
                return;
            }
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            copyValue();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
            event.preventDefault();
            if (event.shiftKey) copyPath();
            else copyValue();
        }
    }, [activeKey, copyPath, copyValue, mutateExpansion]);

    const header = (
        <div className="jsonl-detail__header">
            <span className="jsonl-detail__index">L{index + 1}</span>
            {entry && (
                <span className={`jsonl-chip jsonl-chip--${entry.error ? 'error' : entry.empty ? 'empty' : 'type'}`}>
                    {entry.empty ? $t('jsonl.chipEmpty') : entry.error ? $t('jsonl.invalidJson') : entry.tooLarge ? $t('jsonl.chipTooLarge') : typeLabel(entry.value)}
                </span>
            )}
            {entry && <span className="jsonl-meta">{formatBytes(entry.size)}</span>}
            <span className="jsonl-detail__spacer" />
            {entry?.value !== undefined && (
                <>
                    <Button size="small" type="text" onClick={expandAll}>{$t('jsonl.expandAll')}</Button>
                    <Button size="small" type="text" onClick={collapseAll}>{$t('jsonl.collapseAll')}</Button>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyValue}>
                        {copied === 'value' ? $t('common.copied') : $t('jsonl.value')}
                    </Button>
                    <Button size="small" type="text" onClick={copyPath}>
                        {copied === 'path' ? $t('common.copied') : $t('jsonl.path')}
                    </Button>
                </>
            )}
            <Segmented
                size="small"
                value={mode}
                onChange={value => onModeChange(value as DetailMode)}
                options={[{ label: $t('jsonl.tree'), value: 'tree' }, { label: $t('jsonl.raw'), value: 'raw' }]}
            />
        </div>
    );

    let body: React.ReactNode;
    if (!entry) {
        body = <div className="jsonl-empty">{loading ? $t('jsonl.loading') : $t('jsonl.selectEntry')}</div>;
    } else if (mode === 'raw') {
        body = (
            <pre className="jsonl-detail__raw">{entry.text ?? entry.raw}</pre>
        );
    } else if (entry.empty) {
        body = <div className="jsonl-empty">{$t('jsonl.emptyLine')}</div>;
    } else if (entry.error) {
        body = (
            <div className="jsonl-detail__error">
                <div className="jsonl-chip jsonl-chip--error">{$t('jsonl.invalidJson')}</div>
                <pre className="jsonl-detail__raw">{entry.text ?? entry.raw}</pre>
            </div>
        );
    } else if (entry.tooLarge) {
        body = (
            <div className="jsonl-detail__error">
                <div className="jsonl-chip jsonl-chip--warn">{$t('jsonl.tooLargeToParse')}</div>
                <pre className="jsonl-detail__raw">{entry.text ?? entry.raw}</pre>
            </div>
        );
    } else if (!isComposite(entry.value)) {
        body = (
            <div className="jsonl-detail__scalar">
                <span className="jsonl-type">{typeLabel(entry.value)}</span>
                <span className="jsonl-val">{entry.value === undefined ? '—' : preview(entry.value)}</span>
            </div>
        );
    } else if (built) {
        const tree = (
            <Tree
                className={`jsonl-detail__tree${wrap ? ' jsonl-detail__tree--wrap' : ''}`}
                treeData={built.nodes}
                expandedKeys={expandedKeys}
                onExpand={keys => setExpanded(keys)}
                selectedKeys={activeKey ? [activeKey] : []}
                onSelect={keys => setActiveKey(keys.length ? String(keys[0]) : null)}
                {...(wrap ? {} : { height, itemHeight: ROW_HEIGHT, virtual: true })}
                showIcon={false}
            />
        );
        body = wrap ? <div className="jsonl-detail__scroll">{tree}</div> : tree;
    } else {
        body = <div className="jsonl-empty">{$t('jsonl.noTree')}</div>;
    }

    return (
        <div className="jsonl-detail" ref={containerRef} tabIndex={-1} onKeyDown={onKeyDown}>
            {header}
            <div className="jsonl-detail__body">{body}</div>
        </div>
    );
}


import { CopyOutlined } from '@ant-design/icons';
import { $t } from '../../i18n/i18nConfig.ts';
import { Button, Modal, Segmented, Tree } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonlEntryDetail } from '../../../common/jsonlTypes.ts';
import type { DataNode } from 'antd/es/tree';
import {
    AUTO_EXPAND_LIMIT,
    EXPAND_ALL_CONFIRM,
    ROW_HEIGHT,
    buildEntryModel,
    formatBytes,
    isComposite,
    pathToText,
    preview,
    readPathKey,
    typeLabel,
    valueAtPath,
    type NodeModel,
} from './jsonlFormat.ts';

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

function chipClass(entry: JsonlEntryDetail): string {
    switch (entry.kind) {
        case 'empty': return 'empty';
        case 'invalid': return 'error';
        case 'too-large': return 'warn';
        default: return 'type';
    }
}

function chipLabel(entry: JsonlEntryDetail): string {
    switch (entry.kind) {
        case 'empty': return $t('jsonl.chipEmpty');
        case 'invalid': return $t('jsonl.invalidJson');
        case 'too-large': return $t('jsonl.chipTooLarge');
        default: return typeLabel(entry.value);
    }
}

/** The only adapter between the tree model and antd. */
function toAntdNodes(nodes: NodeModel[], wrap: boolean): DataNode[] {
    return nodes.map(node => {
        if (node.overflow !== undefined) {
            return {
                key: node.key,
                isLeaf: true,
                selectable: false,
                title: <span className="jsonl-more">{$t('jsonl.moreKeys', { count: node.overflow })}</span>,
            };
        }
        const longString = wrap && typeof node.value === 'string';
        return {
            key: node.key,
            isLeaf: !node.composite,
            children: node.composite ? toAntdNodes(node.children, wrap) : undefined,
            title: (
                <span className={`jsonl-kv${wrap ? ' jsonl-kv--wrap' : ''}`}>
                    <span className="jsonl-key">{node.label}</span>
                    <span className="jsonl-colon">:</span>
                    <span className={`jsonl-val jsonl-val--${node.kind}${longString ? ' jsonl-val--wrap' : ''}`}>{node.preview}</span>
                    {node.composite && <span className="jsonl-type">{node.typeLabel}</span>}
                </span>
            ),
        };
    });
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

    // The model decides its own wrapping, so render no longer has to count first and then
    // build; small entries wrap (variable row height, virtual list off), big ones stay on one
    // line so the fixed-height virtual list keeps working.
    const model = useMemo(
        () => (entry?.kind === 'value' ? buildEntryModel(entry.value) : null),
        [entry],
    );
    const wrap = model?.wrap ?? false;

    const defaultExpanded = useMemo<React.Key[]>(() => {
        if (!model) return [];
        return model.count <= AUTO_EXPAND_LIMIT ? model.keys : model.shallowKeys;
    }, [model]);
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
        if (entry?.kind !== 'value') return undefined;
        if (!activeKey) return entry.value;
        return valueAtPath(entry.value, readPathKey(activeKey));
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
        if (!model) return;
        if (model.count > EXPAND_ALL_CONFIRM) {
            Modal.confirm({
                title: $t('jsonl.expandAllConfirmTitle'),
                content: $t('jsonl.expandAllConfirmBody', { count: `${model.count}${model.truncated ? '+' : ''}` }),
                okText: $t('jsonl.expandAll'),
                cancelText: $t('common.cancel'),
                onOk: () => setExpanded(model.keys),
            });
            return;
        }
        setExpanded(model.keys);
    }, [model]);

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
                <span className={`jsonl-chip jsonl-chip--${chipClass(entry)}`}>{chipLabel(entry)}</span>
            )}
            {entry && <span className="jsonl-meta">{formatBytes(entry.size)}</span>}
            <span className="jsonl-detail__spacer" />
            {entry?.kind === 'value' && (
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
        body = <pre className="jsonl-detail__raw">{entry.text}</pre>;
    } else if (entry.kind === 'empty') {
        body = <div className="jsonl-empty">{$t('jsonl.emptyLine')}</div>;
    } else if (entry.kind === 'invalid') {
        body = (
            <div className="jsonl-detail__error">
                <div className="jsonl-chip jsonl-chip--error">{$t('jsonl.invalidJson')}</div>
                <pre className="jsonl-detail__raw">{entry.text}</pre>
            </div>
        );
    } else if (entry.kind === 'too-large') {
        body = (
            <div className="jsonl-detail__error">
                <div className="jsonl-chip jsonl-chip--warn">{$t('jsonl.tooLargeToParse')}</div>
                <pre className="jsonl-detail__raw">{entry.text}</pre>
            </div>
        );
    } else if (!isComposite(entry.value)) {
        body = (
            <div className="jsonl-detail__scalar">
                <span className="jsonl-type">{typeLabel(entry.value)}</span>
                <span className="jsonl-val">{entry.value === undefined ? '—' : preview(entry.value)}</span>
            </div>
        );
    } else if (model) {
        const tree = (
            <Tree
                className={`jsonl-detail__tree${wrap ? ' jsonl-detail__tree--wrap' : ''}`}
                treeData={toAntdNodes(model.nodes, wrap)}
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


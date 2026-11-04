/**
 * Host-side JSONL reading: build a line index once, then hand out parsed lines
 * on demand. The file bytes never cross the postMessage boundary, which keeps
 * large files (hundreds of MB, millions of lines) out of the webview.
 */
import { JSONL_MAX_LINE_BYTES, type JsonlLinePayload } from '@/common/jsonlTypes';

export interface JsonlIndex {
    lineCount: number;
    /** offsets[i] = byte offset where line i starts. */
    offsets: number[];
}

const decoder = new TextDecoder('utf-8');
const RAW_PREVIEW_CHARS = 400;

export function buildJsonlIndex(bytes: Uint8Array): JsonlIndex {
    const offsets: number[] = [0];
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x0a) {
            offsets.push(i + 1);
        }
    }
    // A trailing newline is a terminator, not an empty final line.
    if (offsets.length > 1 && offsets[offsets.length - 1] >= bytes.length) {
        offsets.pop();
    }
    return { offsets, lineCount: offsets.length };
}

function lineBytes(bytes: Uint8Array, index: JsonlIndex, line: number): Uint8Array {
    const start = index.offsets[line];
    const end = line + 1 < index.lineCount ? index.offsets[line + 1] : bytes.length;
    return bytes.subarray(start, end);
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function buildJsonlLine(
    bytes: Uint8Array,
    index: JsonlIndex,
    line: number,
): JsonlLinePayload {
    const slice = lineBytes(bytes, index, line);
    const text = decoder.decode(slice).replace(/[\r\n]+$/, '');
    const size = Math.max(0, slice.length - (text.length < slice.length ? 1 : 0));

    if (text.trim() === '') {
        return { index: line, size, raw: '', empty: true };
    }
    if (size > JSONL_MAX_LINE_BYTES) {
        return {
            index: line,
            size,
            raw: truncate(text, RAW_PREVIEW_CHARS),
            tooLarge: true,
        };
    }
    try {
        return { index: line, size, raw: truncate(text, RAW_PREVIEW_CHARS), value: JSON.parse(text) };
    } catch (error) {
        return {
            index: line,
            size,
            raw: truncate(text, RAW_PREVIEW_CHARS),
            error: error instanceof Error ? error.message : 'Invalid JSON',
        };
    }
}

export function buildJsonlLines(
    bytes: Uint8Array,
    index: JsonlIndex,
    start: number,
    end: number,
): JsonlLinePayload[] {
    const from = Math.max(0, Math.min(start, index.lineCount));
    const to = Math.max(from, Math.min(end, index.lineCount));
    const lines: JsonlLinePayload[] = [];
    for (let i = from; i < to; i++) {
        lines.push(buildJsonlLine(bytes, index, i));
    }
    return lines;
}

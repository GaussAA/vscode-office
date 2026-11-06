import { FormattingOptions } from 'vscode';
import xmlFormat from 'xml-formatter';

/**
 * `xml-formatter` is the maintained formatter for this job (MIT, ~1.8M downloads/week).
 * The previous implementation reached into `provider/http/utils/pretty-data`, a hand-rolled
 * XML/JSON/CSS formatter that came along with the `.http` client — which ADR-0010 deleted.
 */

function getIndentStep(options?: FormattingOptions): string {
    if (options?.insertSpaces === false) {
        return '\t';
    }
    return ' '.repeat(options?.tabSize ?? 2);
}

export function formatXml(text: string, options?: FormattingOptions): string {
    if (!text.trim()) {
        return text;
    }
    try {
        return xmlFormat(text, {
            indentation: getIndentStep(options),
            collapseContent: true,
        });
    } catch {
        // Malformed XML is the user's file, not an exception to surface: leaving it
        // untouched is the same outcome as "the formatter found nothing to do".
        return text;
    }
}

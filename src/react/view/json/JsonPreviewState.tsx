import { Button } from "antd";
import type { JsonInfoPayload } from "../../../common/jsonPreviewTypes.ts";
import { JSON_MAX_ARRAY_BYTES, JSON_MAX_OBJECT_BYTES } from "../../../common/jsonPreviewTypes.ts";
import { $t } from "../../i18n/i18nConfig.ts";
import { formatBytes } from "../entry/entryFormat";

type StateKind = "loading" | "invalid" | "too-large" | "empty";

interface JsonPreviewStateProps {
  kind: StateKind;
  info?: JsonInfoPayload | null;
  onOpenText: () => void;
}

/** One empty/terminal state; the wrapper still owns the shared toolbar and theme. */
export default function JsonPreviewState({ kind, info, onOpenText }: JsonPreviewStateProps) {
  if (kind === "loading") {
    return (
      <div className="json-preview__state">
        <span>{$t("jsonl.loading")}</span>
      </div>
    );
  }
  if (kind === "invalid") {
    return (
      <div className="json-preview__state">
        <div className="json-preview__state-title">{$t("jsonl.invalidJson")}</div>
        <p>
          {info?.error?.message}
          {info?.error
            ? ` · ${$t("json.lineColumn", { line: info.error.line, column: info.error.column })}`
            : ""}
        </p>
        <Button onClick={onOpenText}>{$t("json.openText")}</Button>
      </div>
    );
  }
  if (kind === "too-large") {
    return (
      <div className="json-preview__state">
        <div className="json-preview__state-title">{$t("json.tooLarge")}</div>
        <p>
          {$t("json.tooLargeHint", {
            array: formatBytes(JSON_MAX_ARRAY_BYTES),
            object: formatBytes(JSON_MAX_OBJECT_BYTES),
          })}
        </p>
        <Button onClick={onOpenText}>{$t("json.openText")}</Button>
      </div>
    );
  }
  return (
    <div className="json-preview__state">
      <div className="json-preview__state-title">{$t("json.noRecords")}</div>
      <Button onClick={onOpenText}>{$t("json.openText")}</Button>
    </div>
  );
}

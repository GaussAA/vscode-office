import { FileTextOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import type { ReactNode } from "react";
import type { JsonInfoPayload } from "../../../common/jsonPreviewTypes.ts";
import { $t } from "../../i18n/i18nConfig.ts";
import { formatBytes } from "../jsonl/jsonlFormat";

interface JsonPreviewToolbarProps {
  info: JsonInfoPayload | null;
  meta: string | null;
  query: string;
  searchStatus: ReactNode;
  onQueryChange: (value: string) => void;
  onReload: () => void;
  onOpenText: () => void;
}

/** File identity, search field and the two view-level actions. */
export default function JsonPreviewToolbar({
  info,
  meta,
  query,
  searchStatus,
  onQueryChange,
  onReload,
  onOpenText,
}: JsonPreviewToolbarProps) {
  return (
    <div className="jsonl-toolbar">
      <div className="jsonl-toolbar__left">
        <span className="jsonl-file-name" title={info?.fileName}>
          {info?.fileName ?? "JSON"}
        </span>
        {meta && <span className="jsonl-meta">{meta}</span>}
        {info && (
          <>
            <span className="jsonl-dot">·</span>
            <span className="jsonl-meta">{formatBytes(info.byteSize)}</span>
          </>
        )}
        {info?.fromBuffer && <span className="json-buffer">{$t("json.fromBuffer")}</span>}
      </div>
      <div className="jsonl-toolbar__right">
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder={$t("json.searchRecords")}
          className="jsonl-search"
          value={query}
          disabled={!info || (info.rootKind !== "array" && info.rootKind !== "object")}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onQueryChange("");
            }
          }}
        />
        {searchStatus}
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          aria-label={$t("jsonl.reload")}
          title={$t("jsonl.reload")}
          onClick={onReload}
        />
        <Button
          type="text"
          size="small"
          icon={<FileTextOutlined />}
          aria-label={$t("json.openText")}
          title={$t("json.openText")}
          onClick={onOpenText}
        />
      </div>
    </div>
  );
}

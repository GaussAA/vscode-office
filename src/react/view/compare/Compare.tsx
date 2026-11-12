import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ParquetColumnDiff,
  ParquetCompare,
  ParquetComparePayload,
  ParquetCompareState,
} from "@/common/parquetCompareTypes";
import { $t } from "../../i18n/i18nConfig.ts";
import { handler } from "../../util/vscode.ts";
import "./Compare.less";

/** Findings first, stillness last: the reader opened this panel to see what moved. */
const GROUP_ORDER: ParquetCompareState[] = [
  "added",
  "removed",
  "type-changed",
  "changed",
  "uncomparable",
  "same",
];

const STATE_LABEL: Record<ParquetCompareState, string> = {
  same: "compare.stateSame",
  changed: "compare.stateChanged",
  added: "compare.stateAdded",
  removed: "compare.stateRemoved",
  "type-changed": "compare.stateTypeChanged",
  uncomparable: "compare.stateUncomparable",
};

function percentOf(ratio: number | undefined): string {
  if (ratio === undefined) return "–";
  if (ratio <= 0) return "0%";
  if (ratio < 0.01) return "<1%";
  return `${Math.round(ratio * 100)}%`;
}

function rangeOf(min: string | undefined, max: string | undefined): string {
  if (min === undefined || max === undefined) return "–";
  return `${min} … ${max}`;
}

/** Percentage points, signed: a null share moving 2 points is the finding, not the ratio itself. */
function deltaOf(delta: number | undefined): string {
  if (delta === undefined) return "";
  const points = delta * 100;
  // A delta of zero is noise: it would print "(0%)" on every unchanged row of every file.
  if (Math.abs(points) < 0.05) return "";
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}%`;
}

function typeCell(column: ParquetColumnDiff): string {
  if (column.state === "added" || column.state === "removed") {
    return column.right?.type ?? column.left?.type ?? "–";
  }
  if (column.state === "type-changed") {
    return `${column.left?.type ?? "?"} → ${column.right?.type ?? "?"}`;
  }
  return column.right?.type ?? "–";
}

function nullCell(column: ParquetColumnDiff): string {
  const left = percentOf(column.left?.nullRatio);
  const right = percentOf(column.right?.nullRatio);
  const delta = deltaOf(column.nullRatioDelta);
  return `${left} → ${right}${delta ? ` (${delta})` : ""}`;
}

function rangeCell(column: ParquetColumnDiff): string {
  return `${rangeOf(column.left?.min, column.left?.max)} → ${rangeOf(column.right?.min, column.right?.max)}`;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

export default function Compare() {
  const [compare, setCompare] = useState<ParquetCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    handler.on("compareData", (payload: ParquetComparePayload | undefined) => {
      if (!payload || payload.requestId !== request.current) return;
      if (payload.compare) {
        setCompare(payload.compare);
        setError(null);
        return;
      }
      setError(
        $t(payload.failedSide === "right" ? "compare.errorRight" : "compare.errorLeft", {
          message: payload.error ?? "",
        }),
      );
    });
    request.current += 1;
    handler.emit("compareReload", { requestId: request.current });
  }, []);

  const groups = useMemo(() => {
    if (!compare) return [];
    return GROUP_ORDER.map((state) => ({
      state,
      rows: compare.columns.filter((column) => column.state === state),
    })).filter((group) => group.rows.length > 0 && (!onlyChanged || group.state !== "same"));
  }, [compare, onlyChanged]);

  if (error) {
    return (
      <main className="compare-view">
        <p className="compare-error" role="alert">
          {error}
        </p>
      </main>
    );
  }

  if (!compare) {
    return (
      <main className="compare-view">
        <p className="compare-note">{$t("common.loading")}</p>
      </main>
    );
  }

  return (
    <main className="compare-view">
      <header className="compare-header">
        <h1 className="compare-title">
          <span className="compare-file">{compare.left.fileName}</span>
          <span className="compare-arrow" aria-hidden="true">
            ↔
          </span>
          <span className="compare-file">{compare.right.fileName}</span>
        </h1>
        <p className="compare-counts">
          <span>
            {$t("compare.rows", { count: compare.left.rowCount.toLocaleString() })} →{" "}
            {$t("compare.rows", { count: compare.right.rowCount.toLocaleString() })}
          </span>
          {compare.rowCountDelta !== 0 && (
            <span className="compare-delta">
              {$t("compare.rowDelta", { delta: signed(compare.rowCountDelta) })}
            </span>
          )}
        </p>
        <label className="compare-toggle">
          <input
            type="checkbox"
            checked={onlyChanged}
            onChange={(event) => setOnlyChanged(event.target.checked)}
          />
          {$t("compare.onlyChanged")}
        </label>
      </header>

      <table className="compare-table">
        <thead>
          <tr>
            <th scope="col">{$t("compare.column")}</th>
            <th scope="col">{$t("compare.type")}</th>
            <th scope="col">{$t("compare.nullShare")}</th>
            <th scope="col">{$t("compare.range")}</th>
            <th scope="col">{$t("compare.state")}</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.state} className="compare-group">
            {/* One heading row per finding, not one table per finding: three copies of the
                column headers on one screen is noise, not structure. */}
            <tr className="compare-group-head">
              <th scope="colgroup" colSpan={5} className="compare-group-title">
                {$t(STATE_LABEL[group.state])}
                <span className="compare-group-count">{group.rows.length}</span>
              </th>
            </tr>
            {group.rows.map((column) => (
              <tr
                key={column.name}
                className={`compare-row compare-row--${column.state}`}
                data-state={column.state}
              >
                <td className="compare-name">{column.name}</td>
                <td className="compare-type">{typeCell(column)}</td>
                <td className="compare-null">{nullCell(column)}</td>
                <td className="compare-range">{rangeCell(column)}</td>
                <td className="compare-state">
                  <span className="compare-badge">{$t(STATE_LABEL[column.state])}</span>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </main>
  );
}

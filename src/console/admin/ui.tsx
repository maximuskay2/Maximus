import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsLeft, ChevronsRight } from "lucide-react";

import { t } from "../../lib/i18n";

export function LoadingState({ label }: { label?: string }) {
  return <p role="status" className="mt-3 text-[14px] text-ink-secondary">{label ?? t("console.loading")}</p>;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mt-3 rounded-md border border-dashed border-hairline/60 px-4 py-6 text-center">
      <p className="text-[14px] font-medium">{title}</p>
      {body ? <p className="mt-1 text-[13px] text-ink-secondary">{body}</p> : null}
    </div>
  );
}

export function MetricCard({ label, value, hint, trend }: {
  label: string;
  value: string;
  hint?: string;
  trend?: { direction: "up" | "down" | "flat"; text: string };
}) {
  return (
    <div className="rounded-md border border-hairline/40 px-4 py-3">
      <p className="text-[12px] font-medium text-ink-secondary">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums">{value}</p>
      {trend ? (
        <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-secondary">
          {trend.direction === "up" ? <ArrowUp size={13} /> : trend.direction === "down" ? <ArrowDown size={13} /> : <span aria-hidden>—</span>}
          {trend.text}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-ink-secondary">{hint}</p>
      ) : null}
    </div>
  );
}

/** Trend from first-half vs second-half totals. Null-safe: missing data is flat, never a crash. */
export function sparkTrend(values: (number | null)[]): { direction: "up" | "down" | "flat"; text: string } {
  const cleaned = values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
  if (cleaned.length < 4) return { direction: "flat", text: t("console.dashboard.trendFlat") };
  const half = Math.floor(cleaned.length / 2);
  const first = cleaned.slice(0, half).reduce((sum, value) => sum + value, 0);
  const second = cleaned.slice(half).reduce((sum, value) => sum + value, 0);
  if (first <= 0 && second <= 0) return { direction: "flat", text: t("console.dashboard.trendFlat") };
  if (first <= 0) return { direction: "up", text: t("console.dashboard.trendUp") };
  const change = ((second - first) / first) * 100;
  if (change > 5) return { direction: "up", text: t("console.dashboard.trendChange", { pct: `+${Math.round(change)}%` }) };
  if (change < -5) return { direction: "down", text: t("console.dashboard.trendChange", { pct: `${Math.round(change)}%` }) };
  return { direction: "flat", text: t("console.dashboard.trendFlat") };
}

export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const cleaned = values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
  const max = Math.max(1, ...cleaned);
  const width = 120;
  const height = 32;
  const points = cleaned.map((value, index) => {
    const x = cleaned.length === 1 ? width : (index / (cleaned.length - 1)) * width;
    const y = height - 3 - (value / max) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="text-accent">
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={t("console.dashboard.close")} className="absolute inset-0 cursor-default bg-black/40" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-lg bg-app px-5 py-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[13px] text-ink-secondary hover:bg-control">
            {t("console.dashboard.close")}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface DataColumn<Row> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: Row) => ReactNode;
}

export type SortDirection = "asc" | "desc";

export function sortRows<Row>(rows: Row[], key: string | null, direction: SortDirection, valueOf: (row: Row, key: string) => string | number): Row[] {
  if (!key) return rows;
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = valueOf(a, key);
    const right = valueOf(b, key);
    if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
    return String(left).localeCompare(String(right)) * factor;
  });
}

export function pageRows<Row>(rows: Row[], page: number, pageSize: number): Row[] {
  return rows.slice(page * pageSize, page * pageSize + pageSize);
}

const PAGE_SIZE = 10;

export function DataTable<Row extends { id: string }>({ columns, rows, emptyTitle, emptyBody, valueOf, labelledBy }: {
  columns: DataColumn<Row>[];
  rows: Row[];
  emptyTitle: string;
  emptyBody?: string;
  valueOf: (row: Row, key: string) => string | number;
  labelledBy: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(0);
  const sorted = sortRows(rows, sortKey, direction, valueOf);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = pageRows(sorted, safePage, PAGE_SIZE);
  if (rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return (
    <div>
      <table aria-labelledby={labelledBy} className="mt-3 w-full text-[14px]">
        <thead>
          <tr className="border-b border-hairline/40 text-left text-[13px] text-ink-secondary">
            {columns.map((column) => (
              <th key={column.key} className="py-1.5 pr-3 font-medium">
                {column.sortable ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-ink"
                    aria-label={`${column.header} (${t("console.dashboard.sort")})`}
                    aria-sort={sortKey === column.key ? (direction === "asc" ? "ascending" : "descending") : undefined}
                    onClick={() => {
                      if (sortKey !== column.key) {
                        setSortKey(column.key);
                        setDirection("asc");
                      } else {
                        setDirection(direction === "asc" ? "desc" : "asc");
                      }
                      setPage(0);
                    }}
                  >
                    {column.header}
                    {sortKey === column.key ? (direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id} className="border-t border-hairline/40 align-top">
              {columns.map((column) => (
                <td key={column.key} className="py-2 pr-3">{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[13px] text-ink-secondary">
          <span>{t("console.dashboard.pageOf", { page: safePage + 1, pages })}</span>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label={t("console.dashboard.prevPage")}
              className="rounded-md border border-hairline/40 px-2 py-1 disabled:opacity-40"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronsLeft size={15} />
            </button>
            <button
              type="button"
              aria-label={t("console.dashboard.nextPage")}
              className="rounded-md border border-hairline/40 px-2 py-1 disabled:opacity-40"
              disabled={safePage >= pages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronsRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

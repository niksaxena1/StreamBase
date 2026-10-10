import type { ReactNode } from "react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "./index";
import { fullNumber } from "../../lib/format";
export type Column<T> = {
  key: string;
  label: string;
  numeric?: boolean;
  mono?: boolean;
  sortable?: boolean;
  render: (row: T) => ReactNode;
};
export type Sort = { key: string; direction: "asc" | "desc" };
export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};
export function DataTable<T>({
  label,
  rows,
  columns,
  rowKey,
  sort,
  onSort,
  pagination,
  onRowClick,
  dense = false,
  nowrap = false,
  loading = false,
  error,
  retry,
  emptyMessage = "No rows in this range",
  footerRow,
}: {
  label: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  sort?: Sort;
  onSort?: (sort: Sort) => void;
  pagination?: Pagination;
  onRowClick?: (row: T) => void;
  dense?: boolean;
  /** One line per row (ellipsis + horizontal scroll) for wide tables of short values. */
  nowrap?: boolean;
  loading?: boolean;
  error?: string;
  retry?: () => void;
  emptyMessage?: string;
  /** Total row(s): `<td>` cells, one per column, rendered in a sticky `<tfoot>`. */
  footerRow?: ReactNode;
}) {
  return (
    <Card className={`table-card ${dense ? "dense" : ""} ${nowrap ? "nowrap" : ""}`}>
      <div className="table-scroll">
        <table aria-label={label} aria-busy={loading}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric ? "numeric" : ""}
                  aria-sort={
                    sort?.key === column.key
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSort({
                          key: column.key,
                          direction:
                            sort?.key === column.key && sort.direction === "asc"
                              ? "desc"
                              : "asc",
                        })
                      }
                    >
                      {column.label}{" "}
                      <span aria-hidden="true">
                        {sort?.key === column.key
                          ? sort.direction === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }, (_, r) => (
                <tr key={r} className="skeleton-body-row" aria-hidden="true">
                  {columns.map((column, c) => (
                    <td key={column.key} className={column.numeric ? "numeric" : ""}>
                      <Skeleton style={{ height: 13, width: `${42 + ((r * 7 + c * 11) % 40)}%`, marginLeft: column.numeric ? "auto" : 0 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : error || !rows.length ? (
              <tr>
                <td colSpan={columns.length}>
                  {error ? (
                    <ErrorState message={error} retry={retry} />
                  ) : (
                    <EmptyState title={emptyMessage} />
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  tabIndex={0}
                  aria-label={onRowClick ? `Open ${rowKey(row)}` : undefined}
                  className={onRowClick ? "clickable" : ""}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (
                      onRowClick &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onRowClick(row);
                    }
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      (event.key === "ArrowDown"
                        ? event.currentTarget.nextElementSibling
                        : event.currentTarget.previousElementSibling
                      )?.querySelector("td");
                      (event.key === "ArrowDown"
                        ? (event.currentTarget
                            .nextElementSibling as HTMLElement)
                        : (event.currentTarget
                            .previousElementSibling as HTMLElement)
                      )?.focus();
                    }
                  }}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`${column.numeric ? "numeric mono" : column.mono ? "mono" : ""}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footerRow && !loading && <tfoot>{footerRow}</tfoot>}
        </table>
      </div>
      {pagination && (
        <footer className="row spread table-footer">
          <span className="mono small">
            {fullNumber(pagination.total)} rows · Page{" "}
            {fullNumber(pagination.page + 1)} of{" "}
            {fullNumber(
              Math.max(1, Math.ceil(pagination.total / pagination.pageSize)),
            )}
          </span>
          <div className="row">
            <Button
              disabled={loading || pagination.page === 0}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              disabled={
                loading ||
                (pagination.page + 1) * pagination.pageSize >= pagination.total
              }
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </footer>
      )}
    </Card>
  );
}

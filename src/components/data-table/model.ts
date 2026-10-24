export interface TableColumn<T> {
  id: string;
  title: string;
  value: (row: T) => string | number;
  sortable?: boolean;
}
export function tableView<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
  options: {
    query?: string;
    sort?: string;
    descending?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const query = (options.query || '').trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      !query || columns.some((column) => String(column.value(row)).toLowerCase().includes(query)),
  );
  const column = columns.find((column) => column.id === options.sort && column.sortable !== false);
  if (column)
    filtered.sort((a, b) => {
      const x = column.value(a),
        y = column.value(b);
      const result =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return options.descending ? -result : result;
    });
  const size = Math.max(1, Math.min(100, Math.trunc(options.pageSize || 10)));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.max(1, Math.min(pages, Math.trunc(options.page || 1)));
  return {
    rows: filtered.slice((page - 1) * size, page * size),
    total: filtered.length,
    pages,
    page,
  };
}

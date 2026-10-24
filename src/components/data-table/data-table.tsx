import { m } from '../../locale/paraglide/messages';
import { useState, type ReactNode } from 'react';
import { tableView, type TableColumn } from './model';
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption = m.data_table_records(),
}: {
  rows: readonly T[];
  columns: readonly (TableColumn<T> & { render?: (row: T) => ReactNode })[];
  rowKey: (row: T) => string;
  caption?: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('');
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [hidden, setHidden] = useState<string[]>([]);
  const view = tableView(rows, columns, {
    query,
    sort,
    descending,
    page,
    pageSize: size,
  });
  const visible = columns.filter((column) => !hidden.includes(column.id));
  return (
    <section className="stack">
      <div className="row">
        <label className="field">
          {m.data_table_search()}
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <details>
          <summary>{m.data_table_columns()}</summary>
          {columns.map((column) => (
            <label key={column.id}>
              <input
                type="checkbox"
                checked={!hidden.includes(column.id)}
                onChange={(event) =>
                  setHidden(
                    event.target.checked
                      ? hidden.filter((id) => id !== column.id)
                      : [...hidden, column.id],
                  )
                }
              />
              {column.title}
            </label>
          ))}
        </details>
      </div>
      <div className="table-scroll">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {visible.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={
                    sort === column.id ? (descending ? 'descending' : 'ascending') : 'none'
                  }
                >
                  {column.sortable === false ? (
                    column.title
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDescending(sort === column.id ? !descending : false);
                        setSort(column.id);
                      }}
                    >
                      {column.title}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={rowKey(row)}>
                {visible.map((column) => (
                  <td key={column.id}>
                    {column.render ? column.render(row) : String(column.value(row))}
                  </td>
                ))}
              </tr>
            ))}
            {!view.rows.length && (
              <tr>
                <td colSpan={Math.max(1, visible.length)}>{m.data_table_empty()}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row">
        <label>
          {m.data_table_rows_per_page()}{' '}
          <select
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 20, 30, 40, 50].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <span>
          {m.data_table_pagination({ total: view.total, page: view.page, pages: view.pages })}
        </span>
        <button type="button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
          {m.data_table_previous()}
        </button>
        <button
          type="button"
          disabled={view.page >= view.pages}
          onClick={() => setPage(view.page + 1)}
        >
          {m.data_table_next()}
        </button>
      </div>
    </section>
  );
}

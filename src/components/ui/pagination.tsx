import { m } from '../../locale/paraglide/messages';
import { Button } from './primitives';
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="pagination" aria-label={m.ui_pagination_label()}>
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
      >
        {m.data_table_previous()}
      </Button>
      <span aria-live="polite">
        {page} / {Math.max(1, totalPages)}
      </span>
      <Button
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
      >
        {m.data_table_next()}
      </Button>
    </nav>
  );
}

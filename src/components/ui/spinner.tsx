import { LoaderCircle } from 'lucide-react';
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label}>
      <LoaderCircle className="spin" size={20} />
    </span>
  );
}

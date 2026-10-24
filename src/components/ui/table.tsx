import type { ComponentProps } from 'react';
export function Table(props: ComponentProps<'table'>) {
  return (
    <div className="table-scroll">
      <table {...props} />
    </div>
  );
}
export function TableHeader(props: ComponentProps<'thead'>) {
  return <thead {...props} />;
}
export function TableBody(props: ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}
export function TableFooter(props: ComponentProps<'tfoot'>) {
  return <tfoot {...props} />;
}
export function TableRow(props: ComponentProps<'tr'>) {
  return <tr {...props} />;
}
export function TableHead(props: ComponentProps<'th'>) {
  return <th {...props} />;
}
export function TableCell(props: ComponentProps<'td'>) {
  return <td {...props} />;
}
export function TableCaption(props: ComponentProps<'caption'>) {
  return <caption {...props} />;
}

import type { HTMLAttributes } from 'react';
export function InputGroup({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-input-group ${className}`} />;
}
export function InputGroupAddon(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} />;
}
export { Input as InputGroupInput } from './input';

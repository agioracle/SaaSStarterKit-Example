import type { TextareaHTMLAttributes } from 'react';
export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`ui-input ${className}`} />;
}

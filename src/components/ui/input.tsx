import { Input as BaseInput } from '@base-ui/react/input';
import type { ComponentProps } from 'react';
export function Input({ className = '', ...props }: ComponentProps<typeof BaseInput>) {
  return <BaseInput {...props} className={`ui-input ${className}`} />;
}

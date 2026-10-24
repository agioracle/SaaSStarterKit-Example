import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
export function Checkbox({ className = '', ...props }: ComponentProps<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root {...props} className={`ui-checkbox ${className}`}>
      <BaseCheckbox.Indicator>
        <Check size={13} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

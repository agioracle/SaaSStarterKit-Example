import { useRef, useState, type ReactNode } from 'react';
export function Resizable({
  first,
  second,
  defaultSize = 50,
  minSize = 15,
  maxSize = 85,
  label = 'Resize panels',
}: {
  first: ReactNode;
  second: ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  label?: string;
}) {
  const [size, setSize] = useState(defaultSize);
  const container = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.max(minSize, Math.min(maxSize, value));
  return (
    <div className="ui-resizable" ref={container}>
      <div style={{ width: `${size}%` }}>{first}</div>
      {/* biome-ignore lint/a11y/useSemanticElements: An adjustable separator needs keyboard and pointer interactions unlike a static rule. */}
      <button
        type="button"
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-valuenow={Math.round(size)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setSize((value) => clamp(value + (event.key === 'ArrowLeft' ? -2 : 2)));
          }
        }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = container.current?.getBoundingClientRect();
          if (bounds) setSize(clamp(((event.clientX - bounds.left) / bounds.width) * 100));
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      />
      <div style={{ width: `${100 - size}%` }}>{second}</div>
    </div>
  );
}

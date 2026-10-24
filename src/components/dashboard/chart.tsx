import { m } from '../../locale/paraglide/messages';
import { useId } from 'react';
export interface ChartDatum {
  id: string;
  label: string;
  value: number;
}
/** Accessible caller-supplied data. Never fetches, invents, or labels data as live. */
export function BarChart({
  data,
  title,
  description,
}: {
  data: readonly ChartDatum[];
  title: string;
  description?: string;
}) {
  const id = useId();
  const clean = data.filter((item) => Number.isFinite(item.value) && item.value >= 0);
  const maximum = Math.max(1, ...clean.map((item) => item.value));
  return (
    <figure aria-labelledby={id}>
      <figcaption id={id}>{title}</figcaption>
      {description && <p className="muted">{description}</p>}
      <svg viewBox={`0 0 600 ${Math.max(80, clean.length * 42)}`} role="img" aria-label={title}>
        <title>{title}</title>
        {clean.map((item, index) => (
          <g key={item.id}>
            <text x="0" y={index * 42 + 23} fontSize="12" fill="currentColor">
              {item.label.slice(0, 18)}
            </text>
            <rect
              x="140"
              y={index * 42 + 6}
              width={(item.value / maximum) * 390}
              height="24"
              rx="4"
              fill="currentColor"
              opacity=".65"
            />
            <text x="540" y={index * 42 + 23} fontSize="12" fill="currentColor">
              {item.value}
            </text>
          </g>
        ))}
      </svg>
      <details>
        <summary>{m.dashboard_chart_view_data()}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{m.dashboard_chart_label()}</th>
              <th scope="col">{m.dashboard_chart_value()}</th>
            </tr>
          </thead>
          <tbody>
            {clean.map((item) => (
              <tr key={item.id}>
                <th scope="row">{item.label}</th>
                <td>{item.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

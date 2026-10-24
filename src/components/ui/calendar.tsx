import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale } from '../../locale';
import { m } from '../../locale/paraglide/messages';
import { calendarDateKey, calendarMonth, moveCalendarFocus, utcDate } from './calendar-model';

/** Single-date UTC calendar. Pass initialMonth for immediate deterministic SSR, or defer to today's UTC month after hydration. */
export function Calendar({
  selected,
  initialMonth,
  onSelect,
  disabled,
  label = m.ui_calendar_choose_date(),
  locale = getLocale(),
}: {
  selected?: Date;
  initialMonth?: Date;
  onSelect?: (date: Date) => void;
  disabled?: (date: Date) => boolean;
  label?: string;
  locale?: string;
}) {
  const [month, setMonth] = useState<Date | null>(() =>
    selected || initialMonth ? calendarMonth(selected || (initialMonth as Date)) : null,
  );
  const [focused, setFocused] = useState<string | null>(
    selected ? calendarDateKey(selected) : null,
  );
  const pendingFocus = useRef(false);
  const grid = useRef<HTMLFieldSetElement>(null);
  const id = useId();
  useEffect(() => {
    if (!month) setMonth(calendarMonth(new Date()));
  }, [month]);
  useEffect(() => {
    if (pendingFocus.current && focused) {
      grid.current?.querySelector<HTMLButtonElement>(`button[data-date="${focused}"]`)?.focus();
      pendingFocus.current = false;
    }
  }, [focused]);
  if (!month)
    return (
      <section className="ui-calendar" aria-label={label} aria-busy="true">
        {m.common_loading()}
      </section>
    );
  const days = utcDate(month.getUTCFullYear(), month.getUTCMonth() + 1, 0).getUTCDate();
  const dates = Array.from({ length: days }, (_, index) =>
    utcDate(month.getUTCFullYear(), month.getUTCMonth(), index + 1),
  );
  const active =
    dates.find((day) => calendarDateKey(day) === focused && !disabled?.(day)) ||
    dates.find((day) => !disabled?.(day));
  const formatter = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  return (
    <section className="ui-calendar" aria-label={label}>
      <div className="row between">
        <button
          type="button"
          className="icon-button"
          aria-label={m.ui_calendar_previous_month()}
          onClick={() => setMonth(utcDate(month.getUTCFullYear(), month.getUTCMonth() - 1, 1))}
        >
          <ChevronLeft size={17} />
        </button>
        <strong id={id} aria-live="polite">
          {formatter({ month: 'long', year: 'numeric' }).format(month)}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label={m.ui_calendar_next_month()}
          onClick={() => setMonth(utcDate(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => utcDate(2024, 0, 7 + index)).map((day) => (
          <span key={calendarDateKey(day)}>{formatter({ weekday: 'short' }).format(day)}</span>
        ))}
      </div>
      <fieldset ref={grid} className="calendar-grid" aria-labelledby={id}>
        {Array.from({ length: month.getUTCDay() }, (_, index) =>
          utcDate(month.getUTCFullYear(), month.getUTCMonth(), index - month.getUTCDay() + 1),
        ).map((day) => (
          <span key={calendarDateKey(day)} />
        ))}
        {dates.map((day) => (
          <button
            type="button"
            key={calendarDateKey(day)}
            data-date={calendarDateKey(day)}
            disabled={disabled?.(day)}
            tabIndex={active && calendarDateKey(active) === calendarDateKey(day) ? 0 : -1}
            aria-pressed={!!selected && calendarDateKey(selected) === calendarDateKey(day)}
            aria-label={formatter({ dateStyle: 'full' }).format(day)}
            onFocus={() => setFocused(calendarDateKey(day))}
            onClick={() => onSelect?.(day)}
            onKeyDown={(event) => {
              const next = moveCalendarFocus(day, event.key, disabled);
              if (!next) return;
              event.preventDefault();
              pendingFocus.current = true;
              setFocused(calendarDateKey(next));
              setMonth(calendarMonth(next));
            }}
          >
            {day.getUTCDate()}
          </button>
        ))}
      </fieldset>
    </section>
  );
}

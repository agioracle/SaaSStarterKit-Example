/** Calendar values are UTC civil dates, avoiding host-timezone SSR differences. */
export function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}
export function calendarDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function calendarMonth(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
export function moveCalendarFocus(
  date: Date,
  key: string,
  disabled?: (date: Date) => boolean,
): Date | null {
  const steps: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
    Home: -date.getUTCDay(),
    End: 6 - date.getUTCDay(),
  };
  let next: Date;
  let direction: number;
  if (key === 'PageUp' || key === 'PageDown') {
    direction = key === 'PageUp' ? -1 : 1;
    const target = utcDate(date.getUTCFullYear(), date.getUTCMonth() + direction, 1);
    const days = utcDate(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate();
    next = utcDate(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(date.getUTCDate(), days),
    );
  } else if (key in steps) {
    direction = ['ArrowLeft', 'ArrowUp', 'Home'].includes(key) ? -1 : 1;
    next = utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + steps[key]);
  } else return null;
  for (let scanned = 0; scanned < 366; scanned++) {
    if (!disabled?.(next)) return next;
    next = utcDate(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate() + direction);
  }
  return null;
}

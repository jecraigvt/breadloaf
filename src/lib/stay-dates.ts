/** Visits are calendar dates, stored at midnight UTC, never instants in a guest's timezone. */
export function parseStayDate(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Use a valid date in YYYY-MM-DD format");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Use a valid calendar date");
  }
  return date;
}

export function stayDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid visit date");
  return date.toISOString().slice(0, 10);
}

/** A date-fns/browser display value with the stored calendar day in local time. */
export function stayDisplayDate(value: Date | string): Date {
  return new Date(`${stayDateKey(value)}T12:00:00`);
}

export function localCalendarDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function propertyToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((value) => value.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function stayActiveOnDay(stay: { checkIn: Date | string; checkOut: Date | string }, day: Date): boolean {
  const key = localCalendarDay(day);
  return key >= stayDateKey(stay.checkIn) && key < stayDateKey(stay.checkOut);
}

export function stayNights(checkIn: Date | string, checkOut: Date | string): number {
  return Math.round((parseStayDate(stayDateKey(checkOut)).getTime() - parseStayDate(stayDateKey(checkIn)).getTime()) / 86400000);
}

export function daysUntilStay(checkIn: Date | string, now = new Date()): number {
  return Math.round((parseStayDate(stayDateKey(checkIn)).getTime() - parseStayDate(propertyToday(now)).getTime()) / 86400000);
}

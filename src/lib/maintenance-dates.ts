function dateKey(date: string): string {
  const match = date.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error(`Invalid maintenance date: ${date}`);
  return match[0];
}

function localTodayKey(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatMaintenanceDate(date: string): string {
  const [year, month, day] = dateKey(date).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function isMaintenanceOverdue(
  nextDueAt: string | null,
  today = localTodayKey()
): boolean {
  return nextDueAt ? dateKey(nextDueAt) < today : false;
}

export function toMaintenanceInputDate(date: string | null): string {
  return date ? dateKey(date) : "";
}

export interface AccessProfileIdentity {
  id: string;
  name: string;
  branch: string | null;
  birthday: string | null;
  relTo: { from: { name: string } }[];
}

/** Birthdays may be ISO dates, a year, or historical free text. Never invent a year. */
export function accessBirthYear(birthday: string | null): number | null {
  const years = birthday?.match(/\b(?:18|19|20)\d{2}\b/g) || [];
  if (years.length !== 1) return null;
  const year = Number(years[0]);
  return year <= new Date().getUTCFullYear() ? year : null;
}

const normalized = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const counts = (labels: Map<string, string>) => {
  const result = new Map<string, number>();
  for (const label of Array.from(labels.values())) result.set(normalized(label), (result.get(normalized(label)) || 0) + 1);
  return result;
};

/** Only the caretaker access endpoint uses these private directory facts. */
export function accessProfileLabels(members: AccessProfileIdentity[]): Map<string, string> {
  const labels = new Map(members.map(member => {
    const year = accessBirthYear(member.birthday);
    const detail = [member.name.trim(), member.branch?.trim() ? `${member.branch.trim()} branch` : null, year ? `born ${year}` : null].filter(Boolean);
    return [member.id, detail.join(" · ")];
  }));
  const baseCounts = counts(labels);
  for (const member of members) {
    const label = labels.get(member.id)!;
    if ((baseCounts.get(normalized(label)) || 0) < 2) continue;
    const parents = Array.from(new Set(member.relTo.map(relationship => relationship.from.name.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
    if (parents.length) labels.set(member.id, `${label} · child of ${parents.join(" & ")}`);
  }
  const finalCounts = counts(labels);
  for (const member of members) {
    const label = labels.get(member.id)!;
    // Incomplete directory facts must not produce visually identical choices.
    if ((finalCounts.get(normalized(label)) || 0) > 1) labels.set(member.id, `${label} · profile ${member.id}`);
  }
  return labels;
}

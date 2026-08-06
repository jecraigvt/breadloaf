/**
 * Shared family-roster matcher.
 *
 * This is the ambiguity-refusing logic used by scripts/seed-family-tree.ts and
 * by reviewed family-change proposals. Display names are authoritative first;
 * only rows that remain unmatched fall back to full-name spellings.
 */

export interface MatchableFamilyMember {
  id: string;
  name: string;
  displayName: string | null;
}

export interface FamilyRosterCandidate {
  key: string;
  name: string;
  displayName: string;
  surname?: string | null;
}

export interface FamilyMatchAmbiguity {
  candidateKeys: string[];
  rowIds: string[];
  message: string;
}

export interface FamilyRosterMatchResult {
  matchedId: Map<string, string>;
  ambiguous: FamilyMatchAmbiguity[];
  unmatchedCandidateKeys: string[];
  unmatchedRows: MatchableFamilyMember[];
}

export function normalizeFamilyName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”‘’"']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop an inline nickname so Katherine "K.C." Keller still matches her row. */
export function stripInlineNickname(value: string): string {
  return value
    .replace(/[“‘"']\s*[^”’"']*\s*[”’"']/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowMatchKeys(row: MatchableFamilyMember): string[] {
  return Array.from(
    new Set([
      normalizeFamilyName(row.name),
      normalizeFamilyName(stripInlineNickname(row.name)),
    ])
  ).filter(Boolean);
}

function candidateMatchKeys(person: FamilyRosterCandidate): string[] {
  const keys = new Set<string>();
  const first = person.name.split(" ")[0];
  keys.add(normalizeFamilyName(person.name));
  keys.add(normalizeFamilyName(person.displayName));
  if (person.surname) {
    keys.add(normalizeFamilyName(`${person.displayName} ${person.surname}`));
    keys.add(normalizeFamilyName(`${first} ${person.surname}`));
  }
  return Array.from(keys).filter(Boolean);
}

function intersection(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function describeAmbiguity(
  candidates: FamilyRosterCandidate[],
  rows: MatchableFamilyMember[]
): FamilyMatchAmbiguity {
  const candidateLabels = candidates.map((candidate) => candidate.displayName);
  const rowLabels = rows.map(
    (row) => `${row.displayName ? `${row.displayName} / ` : ""}${row.name} (${row.id})`
  );
  return {
    candidateKeys: candidates.map((candidate) => candidate.key),
    rowIds: rows.map((row) => row.id),
    message: `Could not choose safely between proposal ${candidateLabels.join(", ")} and existing ${rowLabels.join(", ")}`,
  };
}

/**
 * Match every candidate at most once and every existing row at most once.
 *
 * A fallback match is accepted only when it is unique in both directions. Any
 * unresolved component is returned as ambiguous instead of selecting whichever
 * row happened to be read first.
 */
export function matchFamilyRoster(
  existing: MatchableFamilyMember[],
  candidates: FamilyRosterCandidate[]
): FamilyRosterMatchResult {
  const duplicateKeys = candidates
    .map((candidate) => candidate.key)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length) {
    throw new Error(`Family roster candidate keys must be unique: ${Array.from(new Set(duplicateKeys)).join(", ")}`);
  }

  const matchedId = new Map<string, string>();
  const claimedRows = new Set<string>();
  const ambiguous: FamilyMatchAmbiguity[] = [];
  const blockedCandidates = new Set<string>();
  const blockedRows = new Set<string>();

  // Pass 1: exact displayName, the stable identity written by the seed script.
  const candidatesByDisplay = new Map<string, FamilyRosterCandidate[]>();
  const rowsByDisplay = new Map<string, MatchableFamilyMember[]>();
  for (const candidate of candidates) {
    const key = normalizeFamilyName(candidate.displayName);
    if (!key) continue;
    candidatesByDisplay.set(key, [...(candidatesByDisplay.get(key) ?? []), candidate]);
  }
  for (const row of existing) {
    const key = row.displayName ? normalizeFamilyName(row.displayName) : "";
    if (!key) continue;
    rowsByDisplay.set(key, [...(rowsByDisplay.get(key) ?? []), row]);
  }

  for (const [display, displayCandidates] of Array.from(candidatesByDisplay.entries())) {
    const displayRows = rowsByDisplay.get(display) ?? [];
    if (displayRows.length === 0) continue;
    if (displayCandidates.length === 1 && displayRows.length === 1) {
      matchedId.set(displayCandidates[0].key, displayRows[0].id);
      claimedRows.add(displayRows[0].id);
      continue;
    }
    ambiguous.push(describeAmbiguity(displayCandidates, displayRows));
    displayCandidates.forEach((candidate) => blockedCandidates.add(candidate.key));
    displayRows.forEach((row) => blockedRows.add(row.id));
  }

  // Pass 2: full-name spellings. Resolve only one-to-one pairs, repeatedly, so
  // an unambiguous neighbour may safely disambiguate the remaining component.
  let progress = true;
  while (progress) {
    progress = false;
    const availableCandidates = candidates.filter(
      (candidate) => !matchedId.has(candidate.key) && !blockedCandidates.has(candidate.key)
    );
    const availableRows = existing.filter(
      (row) => !claimedRows.has(row.id) && !blockedRows.has(row.id)
    );
    const rowsFor = new Map<string, MatchableFamilyMember[]>();
    const candidatesFor = new Map<string, FamilyRosterCandidate[]>();

    for (const candidate of availableCandidates) {
      const candidateKeys = candidateMatchKeys(candidate);
      const matches = availableRows.filter((row) =>
        intersection(candidateKeys, rowMatchKeys(row))
      );
      rowsFor.set(candidate.key, matches);
      for (const row of matches) {
        candidatesFor.set(row.id, [...(candidatesFor.get(row.id) ?? []), candidate]);
      }
    }

    for (const candidate of availableCandidates) {
      const rows = rowsFor.get(candidate.key) ?? [];
      if (rows.length !== 1) continue;
      const [row] = rows;
      if ((candidatesFor.get(row.id) ?? []).length !== 1) continue;
      matchedId.set(candidate.key, row.id);
      claimedRows.add(row.id);
      progress = true;
    }
  }

  // Anything still joined to a row is ambiguous. Group connected components so
  // one spoken ambiguity produces one useful refusal message.
  const remainingCandidates = candidates.filter(
    (candidate) => !matchedId.has(candidate.key) && !blockedCandidates.has(candidate.key)
  );
  const remainingRows = existing.filter(
    (row) => !claimedRows.has(row.id) && !blockedRows.has(row.id)
  );
  const candidateRows = new Map<string, MatchableFamilyMember[]>();
  for (const candidate of remainingCandidates) {
    const keys = candidateMatchKeys(candidate);
    candidateRows.set(
      candidate.key,
      remainingRows.filter((row) => intersection(keys, rowMatchKeys(row)))
    );
  }

  const visitedCandidates = new Set<string>();
  const visitedRows = new Set<string>();
  for (const seed of remainingCandidates) {
    if (visitedCandidates.has(seed.key) || !(candidateRows.get(seed.key)?.length)) continue;
    const componentCandidates: FamilyRosterCandidate[] = [];
    const componentRows: MatchableFamilyMember[] = [];
    const candidateQueue = [seed];

    while (candidateQueue.length) {
      const candidate = candidateQueue.shift()!;
      if (visitedCandidates.has(candidate.key)) continue;
      visitedCandidates.add(candidate.key);
      componentCandidates.push(candidate);
      for (const row of candidateRows.get(candidate.key) ?? []) {
        if (!visitedRows.has(row.id)) {
          visitedRows.add(row.id);
          componentRows.push(row);
          for (const neighbour of remainingCandidates) {
            if (
              !visitedCandidates.has(neighbour.key) &&
              (candidateRows.get(neighbour.key) ?? []).some((match) => match.id === row.id)
            ) {
              candidateQueue.push(neighbour);
            }
          }
        }
      }
    }

    ambiguous.push(describeAmbiguity(componentCandidates, componentRows));
    componentCandidates.forEach((candidate) => blockedCandidates.add(candidate.key));
    componentRows.forEach((row) => blockedRows.add(row.id));
  }

  return {
    matchedId,
    ambiguous,
    unmatchedCandidateKeys: candidates
      .filter(
        (candidate) => !matchedId.has(candidate.key) && !blockedCandidates.has(candidate.key)
      )
      .map((candidate) => candidate.key),
    unmatchedRows: existing.filter(
      (row) => !claimedRows.has(row.id) && !blockedRows.has(row.id)
    ),
  };
}

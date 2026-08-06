import type { FamilyTree } from "@/lib/family-tree";

export interface IdentityChoice {
  id: string;
  displayName: string;
  fullName: string;
  branch: string | null;
}

export function claimableIdentityChoices(tree: FamilyTree): IdentityChoice[] {
  return Object.values(tree.people)
    .filter((person) => person.canClaim)
    .map(({ id, displayName, fullName, branch }) => ({
      id,
      displayName,
      fullName,
      branch,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function branchRoot(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']s(?:\s+family)?$/, "")
    .replace(/\s+family$/, "");
}

export function choicesForDoorFamily(
  choices: IdentityChoice[],
  doorFamily: string
): IdentityChoice[] {
  if (doorFamily === "local-dev") return choices;
  const root = branchRoot(doorFamily);
  return choices.filter(
    (choice) => choice.branch && branchRoot(choice.branch) === root
  );
}

export function shouldPromptForIdentity(input: {
  doorFamily: string | null;
  hasActor: boolean;
  wasSkipped: boolean;
}): boolean {
  return Boolean(input.doorFamily && !input.hasActor && !input.wasSkipped);
}

export function claimedViaForIdentityClaim(
  context: "door" | "tree",
  hasCredential: boolean
): "pin" | "tap" {
  return context === "door" || hasCredential ? "pin" : "tap";
}

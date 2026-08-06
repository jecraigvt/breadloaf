import { z } from "zod";

export const FAMILY_CHANGE_QUESTION_TYPE = "family_change_proposal";
/** Proposals created during a no-deploy work session stay hidden from the old UI. */
export const FAMILY_CHANGE_STAGED_STATUS = "staged";

const PersonReferenceSchema = z.string().trim().min(1).max(120);
const NullableNameSchema = z.string().trim().min(1).max(120).nullable().optional();

export const FamilyChangeSetSchema = z.object({
  version: z.literal(1).default(1),
  summary: z.string().trim().min(1).max(300),
  sourceMemoryIds: z.array(z.string().trim().min(1)).max(20).default([]),
  people: z.array(z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,49}$/),
    name: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(80),
    surname: NullableNameSchema,
    maidenName: NullableNameSchema,
    possibleMinor: z.boolean().default(false),
    deceased: z.boolean().default(false),
  })).max(30),
  parentEdges: z.array(z.object({
    parent: PersonReferenceSchema,
    child: PersonReferenceSchema,
  })).max(60),
  spouseEdges: z.array(z.object({
    personA: PersonReferenceSchema,
    personB: PersonReferenceSchema,
    status: z.enum(["current", "former"]),
  })).max(30),
  corrections: z.array(z.object({
    target: PersonReferenceSchema,
    changes: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      displayName: z.string().trim().min(1).max(80).optional(),
      surname: NullableNameSchema,
      maidenName: NullableNameSchema,
      deceased: z.boolean().optional(),
    }).refine((changes) => Object.values(changes).some((value) => value !== undefined), {
      message: "A correction must change at least one field",
    }),
  })).max(30),
}).superRefine((changeSet, context) => {
  const keys = changeSet.people.map((person) => person.key);
  for (const duplicate of keys.filter((key, index) => keys.indexOf(key) !== index)) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: `Duplicate proposal person key: ${duplicate}`,
    });
  }
  if (
    changeSet.people.length === 0 &&
    changeSet.parentEdges.length === 0 &&
    changeSet.spouseEdges.length === 0 &&
    changeSet.corrections.length === 0
  ) {
    context.addIssue({ code: "custom", message: "A family proposal cannot be empty" });
  }
});

export type FamilyChangeSet = z.infer<typeof FamilyChangeSetSchema>;
export type FamilyChangePerson = FamilyChangeSet["people"][number];

export const FamilyMinorDecisionsSchema = z.record(
  z.string(),
  z.enum(["minor", "adult"])
);
export type FamilyMinorDecisions = z.infer<typeof FamilyMinorDecisionsSchema>;

export function parseFamilyChangeSet(value: unknown): FamilyChangeSet {
  return FamilyChangeSetSchema.parse(value);
}

export function familyChangeLines(changeSet: FamilyChangeSet): string[] {
  return [
    ...changeSet.people.map((person) =>
      `Add ${person.name}${person.possibleMinor ? " (minor status needs a human decision)" : ""}`
    ),
    ...changeSet.parentEdges.map((edge) => `${edge.parent} → parent of ${edge.child}`),
    ...changeSet.spouseEdges.map(
      (edge) => `${edge.personA} ↔ ${edge.personB} (${edge.status} spouses)`
    ),
    ...changeSet.corrections.map((correction) => {
      const fields = Object.entries(correction.changes)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => `${field} = ${value === null ? "not recorded" : value}`)
        .join(", ");
      return `Correct ${correction.target}: ${fields}`;
    }),
  ];
}

export function familyChangeContext(changeSet: FamilyChangeSet): string {
  return [
    "Bucky has not changed the family tree. Review this complete proposal; the graph is written only after a family member confirms it.",
    ...familyChangeLines(changeSet).map((line) => `• ${line}`),
  ].join("\n");
}

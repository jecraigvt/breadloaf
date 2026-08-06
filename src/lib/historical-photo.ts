import { prisma } from "@/lib/prisma";
import {
  buildFamilyTree,
  loadFamilyGraph,
  type FamilyGraph,
} from "@/lib/family-tree";
import type { IntakeDocumentType } from "@/lib/document-intake";

export interface HistoricalPhotoRosterEntry {
  memberId: string;
  label: string;
  fullName: string;
  branch: string | null;
  generation: number;
  birthOrder: number;
  isMinor: boolean;
  deceased: boolean;
}

export interface HistoricalPhotoAnalysis {
  intakeType?: IntakeDocumentType;
  historicalPhotoCandidateIds?: string[];
  historicalPhotoEra?: string | null;
  historicalPhotoSetting?: string | null;
}

export function buildHistoricalPhotoRoster(
  graph: FamilyGraph
): HistoricalPhotoRosterEntry[] {
  // The public tree is the redaction authority. In particular, current minors'
  // surnames are removed there and must not leak into an AI prompt or option.
  const publicTree = buildFamilyTree(graph, { includePrivateDetail: false });
  const graphMembers = new Map(graph.members.map((member) => [member.id, member]));

  return Object.values(publicTree.people)
    .map((person) => {
      const source = graphMembers.get(person.id);
      const label = person.isMinor
        ? person.displayName
        : [person.displayName, person.surname]
            .filter(Boolean)
            .join(" ");
      return {
        memberId: person.id,
        label,
        fullName: person.fullName,
        branch: person.branch,
        generation: person.generation,
        birthOrder: source?.sortOrder ?? 0,
        isMinor: person.isMinor,
        deceased: person.deceased,
      };
    })
    .sort(
      (left, right) =>
        left.generation - right.generation ||
        left.birthOrder - right.birthOrder ||
        left.label.localeCompare(right.label)
    );
}

export async function loadHistoricalPhotoRoster(): Promise<
  HistoricalPhotoRosterEntry[]
> {
  return buildHistoricalPhotoRoster(await loadFamilyGraph());
}

export function formatHistoricalPhotoRoster(
  roster: HistoricalPhotoRosterEntry[]
): string {
  return roster
    .map(
      (person) =>
        `- ${person.memberId} | ${person.label} | full name: ${person.fullName} | generation ${person.generation} | ${person.branch || "above branch split"} | birth order ${person.birthOrder}${person.deceased ? " | deceased" : ""}`
    )
    .join("\n");
}

export interface HistoricalPhotoQuestionProposal {
  question: string;
  context: string;
  options: string[];
}

function joinNames(labels: string[]): string {
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function buildHistoricalPhotoQuestionProposal(
  analysis: HistoricalPhotoAnalysis,
  roster: HistoricalPhotoRosterEntry[]
): HistoricalPhotoQuestionProposal | null {
  if (analysis.intakeType !== "historical_photo") return null;
  const byId = new Map(roster.map((person) => [person.memberId, person]));
  const candidates = Array.from(
    new Set(analysis.historicalPhotoCandidateIds || [])
  )
    .map((id) => byId.get(id))
    .filter((person): person is HistoricalPhotoRosterEntry => Boolean(person))
    .slice(0, 4);
  if (candidates.length === 0) return null;

  const labels = candidates.map((person) => person.label);
  const proposedPeople = joinNames(labels);
  const setting = analysis.historicalPhotoSetting?.trim();
  const era = analysis.historicalPhotoEra?.trim();
  const details = [setting ? ` at ${setting}` : "", era ? `, ${era}` : ""].join("");
  const options = [
    `Yes — ${proposedPeople}`,
    ...(labels.length > 1 ? labels.map((label) => `Only ${label}`) : []),
    "Someone else",
    "Not sure",
  ];

  return {
    question: `Is this ${proposedPeople}${details}?`,
    context:
      "Bucky compared the visible photo details with the family roster and is proposing an identification rather than asking from scratch. Tap the closest answer; a family answer will be preserved with the photo as searchable provenance.",
    options,
  };
}

export async function createHistoricalPhotoQuestion(input: {
  documentId: string;
  documentTitle: string;
  analysis: HistoricalPhotoAnalysis;
  roster?: HistoricalPhotoRosterEntry[];
}): Promise<boolean> {
  if (input.analysis.intakeType !== "historical_photo") return false;
  const roster = input.roster || await loadHistoricalPhotoRoster();
  const proposal = buildHistoricalPhotoQuestionProposal(input.analysis, roster);
  if (!proposal) return false;

  const existing = await prisma.buckyQuestion.findFirst({
    where: {
      status: "open",
      questionType: "historical_photo_identification",
      sourceType: "document",
      sourceId: input.documentId,
    },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.buckyQuestion.create({
    data: {
      ...proposal,
      questionType: "historical_photo_identification",
      sourceType: "document",
      sourceId: input.documentId,
      sourceLabel: input.documentTitle,
    },
  });
  return true;
}

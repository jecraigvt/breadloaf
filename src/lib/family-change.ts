import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deriveBranches, type FamilyGraph, type GraphMember, type GraphRelationship } from "@/lib/family-tree";
import {
  FAMILY_CHANGE_QUESTION_TYPE,
  FAMILY_CHANGE_STAGED_STATUS,
  FamilyChangeSetSchema,
  FamilyMinorDecisionsSchema,
  familyChangeContext,
  familyChangeLines,
  parseFamilyChangeSet,
  type FamilyChangeSet,
  type FamilyMinorDecisions,
} from "@/lib/family-change-contract";
import {
  matchFamilyRoster,
  normalizeFamilyName,
  type FamilyRosterCandidate,
} from "@/lib/family-member-matcher";

export class FamilyChangeValidationError extends Error {}

interface PlannedCreate {
  token: string;
  key: string;
  name: string;
  displayName: string;
  surname: string | null;
  maidenName: string | null;
  isMinor: boolean;
  deceased: boolean;
}

interface PlannedCorrection {
  memberId: string;
  target: string;
  changes: FamilyChangeSet["corrections"][number]["changes"];
}

interface PlannedEdge {
  fromToken: string;
  toToken: string;
  status: "current" | "former";
}

export interface FamilyChangePlan {
  creates: PlannedCreate[];
  matchedPeople: Array<{ key: string; memberId: string }>;
  corrections: PlannedCorrection[];
  parentEdges: PlannedEdge[];
  spouseEdges: PlannedEdge[];
  tokenToExistingId: Map<string, string>;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function referenceToken(reference: string): string {
  return `existing:${normalizeFamilyName(reference)}`;
}

function ensureNoParentCycle(
  relationships: GraphRelationship[],
  parentEdges: PlannedEdge[]
): void {
  const children = new Map<string, Set<string>>();
  const add = (parent: string, child: string) => {
    children.set(parent, new Set([...Array.from(children.get(parent) ?? []), child]));
  };
  relationships
    .filter((relationship) => relationship.type === "parent")
    .forEach((relationship) => add(relationship.fromMemberId, relationship.toMemberId));
  parentEdges.forEach((edge) => add(edge.fromToken, edge.toToken));

  const reaches = (start: string, target: string, seen = new Set<string>()): boolean => {
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return Array.from(children.get(start) ?? []).some((child) => reaches(child, target, seen));
  };

  for (const edge of parentEdges) {
    if (edge.fromToken === edge.toToken || reaches(edge.toToken, edge.fromToken)) {
      throw new FamilyChangeValidationError("A proposed parent edge would create a family-tree cycle");
    }
  }
}

/** Pure preflight: resolves every name before the transaction writes one row. */
export function planFamilyChange(
  graph: FamilyGraph,
  rawChangeSet: unknown,
  rawMinorDecisions: unknown
): FamilyChangePlan {
  const changeSet = parseFamilyChangeSet(rawChangeSet);
  const minorDecisions = FamilyMinorDecisionsSchema.parse(rawMinorDecisions);
  const peopleByKey = new Map(changeSet.people.map((person) => [person.key, person]));

  for (const person of changeSet.people) {
    if (person.possibleMinor && !minorDecisions[person.key]) {
      throw new FamilyChangeValidationError(
        `${person.displayName}'s minor status requires a human decision`
      );
    }
  }

  const externalReferences = new Set<string>();
  const collect = (reference: string) => {
    if (!peopleByKey.has(reference)) externalReferences.add(reference);
  };
  changeSet.parentEdges.forEach((edge) => {
    collect(edge.parent);
    collect(edge.child);
  });
  changeSet.spouseEdges.forEach((edge) => {
    collect(edge.personA);
    collect(edge.personB);
  });
  changeSet.corrections.forEach((correction) => collect(correction.target));

  const candidates: FamilyRosterCandidate[] = [
    ...changeSet.people.map((person) => ({
      key: person.key,
      name: person.name,
      displayName: person.displayName,
      surname: person.surname,
    })),
    ...Array.from(externalReferences).map((reference) => ({
      key: referenceToken(reference),
      name: reference,
      displayName: reference,
    })),
  ];
  const match = matchFamilyRoster(graph.members, candidates);
  if (match.ambiguous.length) {
    throw new FamilyChangeValidationError(
      `Ambiguous family match; nothing was written. ${match.ambiguous.map((item) => item.message).join("; ")}`
    );
  }

  const missingReferences = Array.from(externalReferences).filter(
    (reference) => !match.matchedId.has(referenceToken(reference))
  );
  if (missingReferences.length) {
    throw new FamilyChangeValidationError(
      `Existing family member not found: ${missingReferences.join(", ")}`
    );
  }

  const tokenToExistingId = new Map<string, string>();
  const tokenForKey = new Map<string, string>();
  const creates: PlannedCreate[] = [];
  const matchedPeople: Array<{ key: string; memberId: string }> = [];

  for (const person of changeSet.people) {
    const existingId = match.matchedId.get(person.key);
    if (existingId) {
      const existing = graph.members.find((member) => member.id === existingId)!;
      if (
        person.possibleMinor &&
        existing.isMinor !== (minorDecisions[person.key] === "minor")
      ) {
        throw new FamilyChangeValidationError(
          `${person.displayName} already exists with a different minor status; propose an explicit correction instead`
        );
      }
      tokenForKey.set(person.key, existingId);
      tokenToExistingId.set(existingId, existingId);
      matchedPeople.push({ key: person.key, memberId: existingId });
      continue;
    }
    const token = `new:${person.key}`;
    tokenForKey.set(person.key, token);
    creates.push({
      token,
      key: person.key,
      name: person.name,
      displayName: person.displayName,
      surname: person.surname ?? null,
      maidenName: person.maidenName ?? null,
      isMinor: person.possibleMinor ? minorDecisions[person.key] === "minor" : false,
      deceased: person.deceased,
    });
  }
  for (const reference of Array.from(externalReferences)) {
    const id = match.matchedId.get(referenceToken(reference))!;
    tokenForKey.set(reference, id);
    tokenToExistingId.set(id, id);
    matchedPeople.push({ key: referenceToken(reference), memberId: id });
  }

  const resolve = (reference: string): string => {
    const token = tokenForKey.get(reference);
    if (!token) throw new FamilyChangeValidationError(`Unresolved family reference: ${reference}`);
    return token;
  };

  const parentEdges = changeSet.parentEdges.map((edge) => ({
    fromToken: resolve(edge.parent),
    toToken: resolve(edge.child),
    status: "current" as const,
  }));
  const spouseEdges = changeSet.spouseEdges.map((edge) => ({
    fromToken: resolve(edge.personA),
    toToken: resolve(edge.personB),
    status: edge.status,
  }));

  for (const edge of [...parentEdges, ...spouseEdges]) {
    if (edge.fromToken === edge.toToken) {
      throw new FamilyChangeValidationError("A family relationship cannot point to the same person twice");
    }
  }
  const spousePairs = new Map<string, "current" | "former">();
  for (const edge of spouseEdges) {
    const pair = [edge.fromToken, edge.toToken].sort().join("|");
    const prior = spousePairs.get(pair);
    if (prior && prior !== edge.status) {
      throw new FamilyChangeValidationError("The same spouse pair has conflicting statuses");
    }
    spousePairs.set(pair, edge.status);
  }

  const corrections = changeSet.corrections.map((correction) => {
    if (peopleByKey.has(correction.target)) {
      throw new FamilyChangeValidationError("Corrections must target an existing family member");
    }
    return {
      memberId: resolve(correction.target),
      target: correction.target,
      changes: correction.changes,
    };
  });

  ensureNoParentCycle(graph.relationships, parentEdges);
  return {
    creates,
    matchedPeople,
    corrections,
    parentEdges,
    spouseEdges,
    tokenToExistingId,
  };
}

export async function createFamilyChangeProposal(
  rawChangeSet: unknown,
  initiatedBy?: string
): Promise<Record<string, unknown>> {
  const changeSet = FamilyChangeSetSchema.parse(rawChangeSet);
  const sourceMemories = changeSet.sourceMemoryIds.length
    ? await prisma.jarvisMemory.findMany({
        where: { id: { in: changeSet.sourceMemoryIds }, sourceType: "voice_note" },
        select: { id: true, source: true },
      })
    : [];
  if (sourceMemories.length !== changeSet.sourceMemoryIds.length) {
    return {
      success: false,
      error: "Every cited sourceMemoryId must identify a retained voice-note memory",
    };
  }

  const existing = await prisma.buckyQuestion.findMany({
    where: {
      status: { in: ["open", FAMILY_CHANGE_STAGED_STATUS] },
      questionType: FAMILY_CHANGE_QUESTION_TYPE,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const sourceKey = [...changeSet.sourceMemoryIds].sort().join("|");
  const duplicate = existing.find((question) => {
    try {
      return [...parseFamilyChangeSet(question.proposedAction).sourceMemoryIds]
        .sort()
        .join("|") === sourceKey && sourceKey.length > 0;
    } catch {
      return false;
    }
  });
  if (duplicate) {
    const duplicateChangeSet = parseFamilyChangeSet(duplicate.proposedAction);
    return {
      success: true,
      action: "already_proposed",
      proposal: { id: duplicate.id, summary: duplicateChangeSet.summary },
      needsMinorDecision: duplicateChangeSet.people
        .filter((person) => person.possibleMinor)
        .map((person) => person.key),
    };
  }

  const sourceNames = Array.from(
    new Set(sourceMemories.map((memory) => memory.source).filter(Boolean))
  );
  const sourceLabel = sourceMemories.length
    ? `${sourceMemories.length} voice note${sourceMemories.length === 1 ? "" : "s"}${sourceNames.length === 1 ? ` from ${sourceNames[0]?.replace(/^Voice note from /, "")}` : ""}`
    : initiatedBy
      ? `Conversation with ${initiatedBy}`
      : "Bucky conversation";
  const question = await prisma.buckyQuestion.create({
    data: {
      question: `Review family-tree proposal: ${changeSet.summary}`,
      context: familyChangeContext(changeSet),
      questionType: FAMILY_CHANGE_QUESTION_TYPE,
      sourceType: sourceMemories.length ? "voice_note" : "conversation",
      sourceId: changeSet.sourceMemoryIds[0],
      sourceLabel,
      proposedAction: jsonValue(changeSet),
    },
  });

  return {
    success: true,
    action: "proposed",
    proposal: { id: question.id, summary: changeSet.summary },
    changes: familyChangeLines(changeSet),
    needsMinorDecision: changeSet.people
      .filter((person) => person.possibleMinor)
      .map((person) => person.key),
    note: "Nothing in the family graph has changed. A family member must review and confirm this proposal in Bucky's Questions tab.",
    _audit: {
      entityType: "family_change_proposal",
      entityId: question.id,
      afterState: changeSet,
    },
  };
}

export interface ConfirmedFamilyChange {
  questionId: string;
  createdPeople: Array<{ id: string; name: string; isMinor: boolean }>;
  matchedPeople: Array<{ key: string; memberId: string }>;
  correctedPeople: Array<{ id: string; target: string }>;
  parentEdgesWritten: number;
  spouseEdgesWritten: number;
  branchUpdates: number;
  confirmedBy: string;
  answer: string;
}

export async function confirmFamilyChangeProposal(input: {
  questionId: string;
  minorDecisions: FamilyMinorDecisions;
  confirmedBy: string;
}): Promise<ConfirmedFamilyChange> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.buckyQuestion.updateMany({
      where: {
        id: input.questionId,
        status: { in: ["open", FAMILY_CHANGE_STAGED_STATUS] },
        questionType: FAMILY_CHANGE_QUESTION_TYPE,
      },
      data: { status: "applying" },
    });
    if (claimed.count !== 1) {
      throw new FamilyChangeValidationError("This proposal is no longer open for confirmation");
    }

    const question = await tx.buckyQuestion.findUnique({ where: { id: input.questionId } });
    if (!question) throw new FamilyChangeValidationError("Family-change proposal not found");
    const changeSet = parseFamilyChangeSet(question.proposedAction);
    const [members, relationships] = await Promise.all([
      tx.familyMember.findMany(),
      tx.familyRelationship.findMany(),
    ]);
    const graph = { members, relationships } as unknown as FamilyGraph;
    const plan = planFamilyChange(graph, changeSet, input.minorDecisions);
    const idByToken = new Map(plan.tokenToExistingId);
    const createdPeople: Array<{ id: string; name: string; isMinor: boolean }> = [];

    for (const create of plan.creates) {
      const member = await tx.familyMember.create({
        data: {
          name: create.name,
          displayName: create.displayName,
          surname: create.surname,
          maidenName: create.maidenName,
          isMinor: create.isMinor,
          deceased: create.deceased,
          canClaim: !create.isMinor && !create.deceased,
        },
      });
      idByToken.set(create.token, member.id);
      createdPeople.push({ id: member.id, name: member.name, isMinor: member.isMinor });
    }

    const correctedPeople: Array<{ id: string; target: string }> = [];
    for (const correction of plan.corrections) {
      const data: Prisma.FamilyMemberUpdateInput = { ...correction.changes };
      if (correction.changes.deceased === true) data.canClaim = false;
      await tx.familyMember.update({ where: { id: correction.memberId }, data });
      correctedPeople.push({ id: correction.memberId, target: correction.target });
    }

    const resolve = (token: string): string => {
      const id = idByToken.get(token) ?? (token.startsWith("new:") ? undefined : token);
      if (!id) throw new FamilyChangeValidationError(`New family member was not created: ${token}`);
      return id;
    };

    for (const edge of plan.parentEdges) {
      const fromMemberId = resolve(edge.fromToken);
      const toMemberId = resolve(edge.toToken);
      await tx.familyRelationship.upsert({
        where: {
          fromMemberId_toMemberId_type: { fromMemberId, toMemberId, type: "parent" },
        },
        create: { fromMemberId, toMemberId, type: "parent", status: "current" },
        update: {},
      });
    }

    for (const edge of plan.spouseEdges) {
      const fromMemberId = resolve(edge.fromToken);
      const toMemberId = resolve(edge.toToken);
      const existingSpouse = await tx.familyRelationship.findFirst({
        where: {
          type: "spouse",
          OR: [
            { fromMemberId, toMemberId },
            { fromMemberId: toMemberId, toMemberId: fromMemberId },
          ],
        },
      });
      if (existingSpouse) {
        await tx.familyRelationship.update({
          where: { id: existingSpouse.id },
          data: { status: edge.status },
        });
      } else {
        // Store one direction exactly once; partnersOf() supplies symmetry at read time.
        await tx.familyRelationship.create({
          data: { fromMemberId, toMemberId, type: "spouse", status: edge.status },
        });
      }
    }

    const [membersAfter, relationshipsAfter] = await Promise.all([
      tx.familyMember.findMany(),
      tx.familyRelationship.findMany(),
    ]);
    const branchOf = deriveBranches({
      members: membersAfter as unknown as GraphMember[],
      relationships: relationshipsAfter as unknown as GraphRelationship[],
    });
    let branchUpdates = 0;
    for (const member of membersAfter) {
      const derived = branchOf.get(member.id) ?? null;
      if (derived !== member.branch) {
        await tx.familyMember.update({ where: { id: member.id }, data: { branch: derived } });
        branchUpdates++;
      }
    }

    const minorLabels = changeSet.people
      .filter((person) => person.possibleMinor)
      .map((person) => `${person.displayName}: ${input.minorDecisions[person.key]}`);
    const answer = `Confirmed ${changeSet.summary}${minorLabels.length ? ` (${minorLabels.join(", ")})` : ""}`;
    await tx.buckyQuestion.update({
      where: { id: question.id },
      data: {
        status: "answered",
        answer,
        answeredBy: input.confirmedBy,
        answeredAt: new Date(),
      },
    });

    return {
      questionId: question.id,
      createdPeople,
      matchedPeople: plan.matchedPeople,
      correctedPeople,
      parentEdgesWritten: plan.parentEdges.length,
      spouseEdgesWritten: plan.spouseEdges.length,
      branchUpdates,
      confirmedBy: input.confirmedBy,
      answer,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

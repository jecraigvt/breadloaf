import { prisma } from "@/lib/prisma";
import { archiveVerificationStalenessMessage } from "@/lib/archive-health-shared";
export { archiveVerificationStalenessMessage } from "@/lib/archive-health-shared";

export const LATEST_ARCHIVE_VERIFICATION = {
  measuredAt: "2026-08-05",
  roundTrip: { passed: 47, total: 50, rate: 94 },
  golden: { passed: 22, total: 25, rate: 88 },
  negativeControls: { passed: 4, total: 4 },
  knownCeiling: {
    roundTrip: { passed: 48, total: 50 },
    golden: { passed: 23, total: 25 },
  },
} as const;

export interface ArchiveHealth {
  totalDocuments: number;
  readyDocuments: number;
  issueDocuments: number;
  documentsAddedAfterMeasurement: number;
  analysisStates: Record<string, number>;
  verification: typeof LATEST_ARCHIVE_VERIFICATION;
}

export async function getArchiveHealth(): Promise<ArchiveHealth> {
  const measuredThrough = new Date(
    `${LATEST_ARCHIVE_VERIFICATION.measuredAt}T23:59:59.999Z`
  );
  const [stateGroups, documentsAddedAfterMeasurement] = await Promise.all([
    prisma.document.groupBy({
      by: ["analysisState"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.document.count({
      where: { deletedAt: null, createdAt: { gt: measuredThrough } },
    }),
  ]);

  const analysisStates = Object.fromEntries(
    stateGroups.map((group) => [group.analysisState, group._count._all])
  );
  const totalDocuments = stateGroups.reduce(
    (total, group) => total + group._count._all,
    0
  );
  const readyDocuments = analysisStates.ok || 0;

  return {
    totalDocuments,
    readyDocuments,
    issueDocuments: totalDocuments - readyDocuments,
    documentsAddedAfterMeasurement,
    analysisStates,
    verification: LATEST_ARCHIVE_VERIFICATION,
  };
}

export function formatArchiveHealthForBucky(health: ArchiveHealth): string {
  const states = Object.entries(health.analysisStates)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => `${state} ${count}`)
    .join(" / ");
  const verification = health.verification;
  const staleness = archiveVerificationStalenessMessage(
    health.documentsAddedAfterMeasurement
  );

  return [
    `ARCHIVE HEALTH (latest measured ${verification.measuredAt}):`,
    `- ${health.readyDocuments} of ${health.totalDocuments} active documents have analysisState ok; ${health.issueDocuments} are not ok`,
    `- Analysis states: ${states || "no active documents"}`,
    `- Round-trip retrieval: ${verification.roundTrip.rate.toFixed(1)}% (${verification.roundTrip.passed}/${verification.roundTrip.total})`,
    `- Golden questions: ${verification.golden.rate.toFixed(1)}% (${verification.golden.passed}/${verification.golden.total})`,
    `- Negative controls: ${verification.negativeControls.passed}/${verification.negativeControls.total}`,
    `- Known ceiling with the two blank source files: round-trip ${verification.knownCeiling.roundTrip.passed}/${verification.knownCeiling.roundTrip.total}; golden ${verification.knownCeiling.golden.passed}/${verification.knownCeiling.golden.total}`,
    ...(staleness ? [`- STALE VERIFICATION: ${staleness}`] : []),
  ].join("\n");
}

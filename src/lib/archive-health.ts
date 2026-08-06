import { prisma } from "@/lib/prisma";
import { latestVerificationRuns } from "@/lib/archive-verification-record";
import { archiveVerificationStalenessMessage } from "@/lib/archive-health-shared";
export { archiveVerificationStalenessMessage } from "@/lib/archive-health-shared";

export interface VerificationCounts {
  passed: number;
  total: number;
}

export interface ArchiveVerificationSummary {
  measuredAt: string;
  roundTrip: VerificationCounts & { rate: number };
  golden: VerificationCounts & { rate: number };
  negativeControls: VerificationCounts;
  knownCeiling: { roundTrip: VerificationCounts; golden: VerificationCounts };
}

/**
 * Fallback for an archive that has never had a harness recorded against it.
 * Once `npm run archive:verify:*` has run, `getArchiveHealth` reads the stored
 * run instead and this is unused.
 */
export const LATEST_ARCHIVE_VERIFICATION: ArchiveVerificationSummary = {
  measuredAt: "2026-08-05",
  roundTrip: { passed: 47, total: 50, rate: 94 },
  golden: { passed: 22, total: 25, rate: 88 },
  negativeControls: { passed: 4, total: 4 },
  knownCeiling: {
    roundTrip: { passed: 48, total: 50 },
    golden: { passed: 23, total: 25 },
  },
};

export interface ArchiveHealth {
  totalDocuments: number;
  readyDocuments: number;
  issueDocuments: number;
  documentsAddedAfterMeasurement: number;
  analysisStates: Record<string, number>;
  /** Recorded harness run when one exists, else the checked-in fallback. */
  verification: ArchiveVerificationSummary;
}

export async function getArchiveHealth(): Promise<ArchiveHealth> {
  // Prefer what a harness actually recorded; fall back to the constant only
  // until the first run lands. A literal that reads as a measurement is the
  // same failure shape as a placeholder summary — running the checks is what
  // should update what everyone sees.
  const runs = await latestVerificationRuns().catch(() => null);
  const verification: ArchiveVerificationSummary = runs?.["round-trip"] && runs.golden
    ? {
        measuredAt: [runs["round-trip"].measuredAt, runs.golden.measuredAt]
          .sort((a, b) => a.getTime() - b.getTime())[0]
          .toISOString()
          .slice(0, 10),
        roundTrip: {
          passed: runs["round-trip"].passed,
          total: runs["round-trip"].total,
          rate: runs["round-trip"].rate,
        },
        golden: {
          passed: runs.golden.passed,
          total: runs.golden.total,
          rate: runs.golden.rate,
        },
        negativeControls: {
          passed: runs["round-trip"].controlsPassed + runs.golden.controlsPassed,
          total: runs["round-trip"].controlsTotal + runs.golden.controlsTotal,
        },
        knownCeiling: LATEST_ARCHIVE_VERIFICATION.knownCeiling,
      }
    : LATEST_ARCHIVE_VERIFICATION;

  const measuredThrough = new Date(
    `${verification.measuredAt}T23:59:59.999Z`
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
    verification,
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

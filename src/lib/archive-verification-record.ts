import { prisma } from "@/lib/prisma";

export type VerificationSuite = "round-trip" | "golden";

export interface VerificationRun {
  suite: VerificationSuite;
  passed: number;
  total: number;
  rate: number;
  controlsPassed: number;
  controlsTotal: number;
  failures: string[];
}

/**
 * Persist a harness run so the health panel reports what was measured.
 *
 * The panel used to read a hardcoded constant that nobody was obliged to update
 * after an upload, which made it a literal wearing a measurement's clothes —
 * the same failure shape as the placeholder summaries that hid eight unfindable
 * documents for a month. Running the harness is now what updates what everyone
 * sees.
 */
export async function recordVerificationRun(run: VerificationRun): Promise<void> {
  await prisma.archiveVerification.create({
    data: {
      suite: run.suite,
      passed: run.passed,
      total: run.total,
      rate: run.rate,
      controlsPassed: run.controlsPassed,
      controlsTotal: run.controlsTotal,
      // Kept so a later reader can see WHICH checks failed without re-running a
      // suite whose round-trip questions are regenerated every time.
      failures: run.failures.length ? run.failures : undefined,
    },
  });
}

export interface LatestVerification {
  suite: VerificationSuite;
  passed: number;
  total: number;
  rate: number;
  controlsPassed: number;
  controlsTotal: number;
  measuredAt: Date;
}

/** The most recent run of each suite, or null when a suite has never been run. */
export async function latestVerificationRuns(): Promise<
  Record<VerificationSuite, LatestVerification | null>
> {
  const rows = await prisma.archiveVerification.findMany({
    orderBy: { measuredAt: "desc" },
    take: 50,
  });

  const newest = (suite: VerificationSuite): LatestVerification | null => {
    const row = rows.find((candidate) => candidate.suite === suite);
    if (!row) return null;
    return {
      suite,
      passed: row.passed,
      total: row.total,
      rate: row.rate,
      controlsPassed: row.controlsPassed,
      controlsTotal: row.controlsTotal,
      measuredAt: row.measuredAt,
    };
  };

  return { "round-trip": newest("round-trip"), golden: newest("golden") };
}

import type { WorkerConfig } from "./config";

export type JobKind = "document_analysis" | "archive_review" | "site_improvement";
export interface Job {
  id: string; kind: JobKind; request: Record<string, unknown>;
  checkpoint?: { parts?: Record<string, unknown>; [key: string]: unknown } | null;
}
export interface Claim { job: Job; leaseToken: string; leaseExpiresAt: string; attemptId: string; reservedCents?: number }
export interface SourcePart {
  id: string; sourceId: string; fileName: string; mimeType: string;
  checksum?: string; text?: string; imageBase64?: string; fileBase64?: string;
}
export interface SourceBundle {
  jobId: string; kind: JobKind; instructions: string;
  categories: { name: string; description?: string | null }[];
  resultSchema: Record<string, unknown>; parts: SourcePart[];
}

export class WorkerHttpError extends Error {
  constructor(public status: number) { super(`Worker request failed (${status})`); }
}

export class WorkerClient {
  constructor(readonly config: WorkerConfig, private token: string, private transport: typeof fetch = fetch) {}
  async request<T>(route: string, data?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.transport(`${this.config.siteUrl}/api/bucky/worker/${route}`, {
      method: data === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${this.token}`, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new WorkerHttpError(response.status);
    return await response.json() as T;
  }
  claim(quotaRemaining: number | null, capabilities = this.config.capabilities) {
    return this.request<Claim | null>("claim", { workerId: this.config.workerId, capabilities, quotaRemaining });
  }
  credentials(claim: Claim) { return { workerId: this.config.workerId, jobId: claim.job.id, leaseToken: claim.leaseToken }; }
  source(claim: Claim, sourceId?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ jobId: claim.job.id, leaseToken: claim.leaseToken, workerId: this.config.workerId });
    if (sourceId) query.set("sourceId", sourceId);
    return this.request<SourceBundle>(`source?${query}`, undefined, signal);
  }
  heartbeat(claim?: Claim, checkpoint?: unknown, quotaRemaining?: number | null) {
    return this.request<{ leaseExpiresAt?: string }>("heartbeat", {
      ...(claim ? this.credentials(claim) : { workerId: this.config.workerId }),
      ...(checkpoint === undefined ? {} : { checkpoint }), ...(quotaRemaining === undefined ? {} : { quotaRemaining }),
    });
  }
}

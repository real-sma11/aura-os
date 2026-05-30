import { apiFetch } from "../shared/api/core";
import type { Task } from "../shared/types";
import type { BugDiagnostics } from "../shared/observability/collect-bug-diagnostics";

/**
 * Wire payload for `POST /api/bug-reports`. Field names are the
 * camelCase shape the server's `CreateBugReportRequest`
 * (`#[serde(rename_all = "camelCase")]`) deserializes — `diagnostics`
 * is the arbitrary captured bundle, and the server rejects the
 * submission with 400 unless `consent === true`.
 */
export interface CreateBugReportInput {
  description: string;
  category?: string;
  severity?: string;
  diagnostics: BugDiagnostics | Record<string, unknown>;
  consent: boolean;
  consentVersion: string;
  /**
   * Client-stamped consent timestamp. The server also stamps its own
   * authoritative `consented_at`, but we include the client's view for
   * auditability; unknown fields are ignored server-side.
   */
  consentedAt?: string;
}

export interface CreateBugReportResponse {
  id: string;
}

/**
 * Admin/self read shape mirroring the server `BugReport` record
 * (camelCase). Only `create` is consumed in Phase 2; `list` / `get` /
 * `listMine` are typed here so the Phase 3 admin viewer can reuse the
 * same client without redefining the contract.
 */
export interface BugReportDto {
  id: string;
  createdAt: string;
  userId: string;
  networkUserId?: string | null;
  displayName: string;
  description: string;
  category?: string | null;
  severity?: string | null;
  diagnostics: unknown;
  llmSummary?: string | null;
  status: string;
  consent: boolean;
  consentVersion?: string | null;
  consentedAt?: string | null;
  feedbackPostId?: string | null;
  linkedTaskId?: string | null;
  linkedProjectId?: string | null;
}

export interface CreateFixTaskInput {
  projectId: string;
  agentInstanceId?: string;
}

/**
 * Result of `POST /api/bug-reports/:id/fix-task`: the freshly created
 * fix task plus the project it was created under (so the admin UI can
 * immediately offer "Run now" against `tasksApi.runTask`).
 */
export interface CreateFixTaskResponse {
  task: Task;
  projectId: string;
  bugReportId: string;
}

export const bugReportsApi = {
  create: (input: CreateBugReportInput): Promise<CreateBugReportResponse> =>
    apiFetch<CreateBugReportResponse>("/api/bug-reports", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  list: (): Promise<BugReportDto[]> =>
    apiFetch<BugReportDto[]>("/api/bug-reports"),

  get: (id: string): Promise<BugReportDto> =>
    apiFetch<BugReportDto>(`/api/bug-reports/${id}`),

  listMine: (): Promise<BugReportDto[]> =>
    apiFetch<BugReportDto[]>("/api/bug-reports/mine"),

  createFixTask: (
    id: string,
    input: CreateFixTaskInput,
  ): Promise<CreateFixTaskResponse> =>
    apiFetch<CreateFixTaskResponse>(`/api/bug-reports/${id}/fix-task`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

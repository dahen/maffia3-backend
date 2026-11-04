import { z } from 'zod';

export const releaseVersion = z.string().regex(/^v\d+\.\d+\.\d+$/);
export const imagePrefix = 'ghcr.io/dahen/maffia3-backend';
export const releaseSchema = z.object({
  version: releaseVersion,
  image: z.string().regex(/^ghcr\.io\/dahen\/maffia3-backend@sha256:[a-f0-9]{64}$/),
  backend: z.string().regex(/^[a-f0-9]{40}$/),
  frontend: z.string().regex(/^[a-f0-9]{40}$/),
}).strict();
export type Release = z.infer<typeof releaseSchema>;
export const jobRequestSchema = z.object({ version: releaseVersion, requestId: z.uuid() }).strict();
export const jobSchema = z.object({
  requestId: z.uuid(), version: releaseVersion,
  phase: z.enum(['pulling', 'backup', 'starting', 'checking', 'complete', 'failed', 'recovery-required']),
  startedAt: z.iso.datetime(), updatedAt: z.iso.datetime(), message: z.string(),
});
export type UpdateJob = z.infer<typeof jobSchema>;
export const hostStatusSchema = z.object({
  latest: releaseSchema.nullable(), job: jobSchema.nullable(), releaseError: z.string().nullable(),
});
export type HostStatus = z.infer<typeof hostStatusSchema>;
export interface UpdateStatus extends HostStatus {
  configured: boolean;
  current: { version: string; backend: string; frontend: string };
}
export const activeJob = (job: UpdateJob | null) => Boolean(job && ['pulling', 'backup', 'starting', 'checking'].includes(job.phase));

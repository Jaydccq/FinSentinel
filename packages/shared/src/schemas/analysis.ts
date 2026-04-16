import { z } from 'zod';
import { orderDraftsPayloadSchema } from './order-draft';

// ── Enums ────────────────────────────────────────────────────────────────────
export const analysisRunSourceModeSchema = z.enum([
  'CHAT',
  'WORKSPACE',
  'SCHEDULE',
  'HEARTBEAT',
]);
export type AnalysisRunSourceMode = z.infer<typeof analysisRunSourceModeSchema>;

export const analysisRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'PAUSED',
  'FAILED',
  'COMPLETED',
  'CANCELED',
]);
export type AnalysisRunStatus = z.infer<typeof analysisRunStatusSchema>;

export const analysisStageKeySchema = z.enum([
  'INTELLIGENCE',
  'THESIS',
  'RISK',
  'EXECUTION_PREP',
  'HUMAN_APPROVAL',
]);
export type AnalysisStageKey = z.infer<typeof analysisStageKeySchema>;

export const stageStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const artifactKindSchema = z.enum([
  'STAGE_STRUCTURED_OUTPUT',
  'STAGE_HUMAN_REPORT',
  'ORDER_DRAFTS',
  'EXECUTION_PAYLOAD',
  'ALERT_PAYLOAD',
  'STRATEGY_ARCHIVE',
  'FINAL_REPORT',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const approvalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

// ── Context layers ───────────────────────────────────────────────────────────
export const contextLayerSchema = z.object({
  summary: z.string(),
  sourceIds: z.array(z.string()),
  updatedAt: z.string().datetime().optional(),
});
export type ContextLayer = z.infer<typeof contextLayerSchema>;

export const sharedContextSchema = z.object({
  longTermPreferenceContext: contextLayerSchema,
  midTermStrategyContext: contextLayerSchema,
  shortTermSessionContext: contextLayerSchema,
  retrievalContext: contextLayerSchema,
});
export type SharedContext = z.infer<typeof sharedContextSchema>;

// ── Stage I/O handoff ────────────────────────────────────────────────────────
export const citationSchema = z.object({
  artifactId: z.string().optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
});
export type Citation = z.infer<typeof citationSchema>;

export const stageStructuredOutputSchema = z
  .object({
    summary: z.string(),
    thesis: z.string(),
    risks: z.array(z.string()),
    openQuestions: z.array(z.string()),
    citations: z.array(citationSchema),
    confidence: z.number().min(0).max(1),
  })
  .passthrough();
export type StageStructuredOutput = z.infer<typeof stageStructuredOutputSchema>;

// ── Decision object (system-primary) ─────────────────────────────────────────
export const decisionObjectSchema = z.object({
  portfolioDecision: z.string(),
  allocationGuidance: z.object({
    notes: z.string(),
    targets: z.array(
      z.object({
        symbol: z.string(),
        targetPercent: z.number(),
      }),
    ),
  }),
  riskLimits: z.object({
    maxDrawdownPct: z.number(),
    stopLossTriggers: z.array(z.string()),
  }),
  alertTriggers: z.array(
    z.object({
      condition: z.string(),
      channel: z.string().optional(),
    }),
  ),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()),
  executionPayload: orderDraftsPayloadSchema,
  alertPayload: z.object({ alerts: z.array(z.record(z.string(), z.unknown())) }),
  strategyArchivePayload: z.object({ snapshot: z.record(z.string(), z.unknown()) }),
});
export type DecisionObject = z.infer<typeof decisionObjectSchema>;

// ── Preflight complexity estimate ────────────────────────────────────────────
export const complexityEstimateSchema = z.object({
  predictedToolCalls: z.number().int().nonnegative(),
  predictedToolRounds: z.number().int().nonnegative(),
  predictedWallClockSec: z.number().nonnegative(),
  upgradeRecommended: z.boolean(),
  upgradeReason: z.string(),
});
export type ComplexityEstimate = z.infer<typeof complexityEstimateSchema>;

// ── API request / response contracts ─────────────────────────────────────────
export const createRunRequestSchema = z.object({
  prompt: z.string().min(1),
  sourceMode: analysisRunSourceModeSchema,
  ticker: z.string().optional(),
  portfolioId: z.string().uuid().optional(),
  parentChatSessionId: z.string().uuid().optional(),
  enabledTeams: z.array(analysisStageKeySchema).optional(),
  researchDepth: z.enum(['SHALLOW', 'STANDARD', 'DEEP']).optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const analysisRunResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sourceMode: analysisRunSourceModeSchema,
  status: analysisRunStatusSchema,
  currentStageKey: analysisStageKeySchema.nullable(),
  complexityScore: z.number().nullable(),
  upgradeReason: z.string().nullable(),
  parentChatSessionId: z.string().uuid().nullable(),
  inputSnapshot: z.record(z.string(), z.unknown()),
  sharedContext: sharedContextSchema.nullable(),
  decisionObject: decisionObjectSchema.nullable(),
  finalReportMarkdown: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});
export type AnalysisRunResponse = z.infer<typeof analysisRunResponseSchema>;

export const analysisStageResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stageKey: analysisStageKeySchema,
  status: stageStatusSchema,
  checkpointVersion: z.number().int().nonnegative(),
  parallelGroupKey: z.string().nullable(),
  structuredOutput: stageStructuredOutputSchema.nullable(),
  humanReportMarkdown: z.string().nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type AnalysisStageResponse = z.infer<typeof analysisStageResponseSchema>;

export const analysisArtifactResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
  artifactKind: artifactKindSchema,
  artifactName: z.string(),
  mimeType: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  storageUri: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AnalysisArtifactResponse = z.infer<typeof analysisArtifactResponseSchema>;

export const analysisApprovalResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  approvalType: z.literal('EXECUTION_APPROVAL'),
  status: approvalStatusSchema,
  requestedPayload: z.record(z.string(), z.unknown()),
  approvedPayload: z.record(z.string(), z.unknown()).nullable(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().uuid().nullable(),
});
export type AnalysisApprovalResponse = z.infer<typeof analysisApprovalResponseSchema>;

export const approveExecutionRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().optional(),
});
export type ApproveExecutionRequest = z.infer<typeof approveExecutionRequestSchema>;

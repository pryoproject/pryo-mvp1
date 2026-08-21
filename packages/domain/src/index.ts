import { z } from "zod";

export const AuditAreaSchema = z.enum([
  "positioning",
  "cro",
  "seo",
  "performance",
  "market",
  "competition",
  "technology",
  "ai_discoverability"
]);
export type AuditArea = z.infer<typeof AuditAreaSchema>;

export const FindingStatusSchema = z.enum([
  "strong",
  "improve",
  "important",
  "critical",
  "insufficient_data"
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const DecisionSchema = z.enum(["do_now", "validate", "preserve", "monitor", "ignore"]);
export type Decision = z.infer<typeof DecisionSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  type: z.enum(["measured", "observed", "inferred"]),
  sourceProvider: z.string(),
  sourceUrl: z.string().url().optional(),
  observedAt: z.string(),
  reliability: z.number().min(0).max(1),
  excerpt: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({})
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const AuditCheckSchema = z.object({
  id: z.string(),
  code: z.string(),
  area: AuditAreaSchema,
  label: z.string(),
  passed: z.boolean().nullable(),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  weight: z.number().positive(),
  evidenceIds: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type AuditCheck = z.infer<typeof AuditCheckSchema>;

export const RecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  action: z.string(),
  validation: z.string(),
  ownerType: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  affectedKpis: z.array(z.string()).default([]),
  estimatedEffort: z.enum(["xs", "s", "m", "l", "xl"]),
  timeToSignal: z.string().optional()
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  auditId: z.string(),
  area: AuditAreaSchema,
  code: z.string(),
  title: z.string(),
  description: z.string(),
  status: FindingStatusSchema,
  decision: DecisionSchema,
  rootCauseId: z.string().optional(),
  evidenceIds: z.array(z.string()).min(1),
  recommendation: RecommendationSchema.optional(),
  scores: z.object({
    impact: z.number().min(0).max(10),
    confidence: z.number().min(0).max(10),
    ease: z.number().min(0).max(10),
    ice: z.number().min(0).max(1000),
    urgency: z.number().min(0.5).max(1.5),
    unlock: z.number().min(1).max(1.25),
    priority: z.number().min(0).max(100)
  }),
  affectedKpis: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  expectedOutcome: z.string().optional(),
  timeToSignal: z.string().optional(),
  validationMethod: z.string().optional(),
  createdAt: z.string()
});
export type Finding = z.infer<typeof FindingSchema>;

export const RootCauseSchema = z.object({
  id: z.string(),
  area: AuditAreaSchema,
  title: z.string(),
  description: z.string(),
  findingIds: z.array(z.string()).min(1),
  evidenceIds: z.array(z.string()),
  decision: DecisionSchema,
  status: FindingStatusSchema,
  confidence: z.number().min(0).max(100),
  priority: z.number().min(0).max(100),
  action: z.string(),
  validation: z.string(),
  timeToSignal: z.string().optional()
});
export type RootCause = z.infer<typeof RootCauseSchema>;

export const CategoryScoreSchema = z.object({
  area: AuditAreaSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  coverage: z.number().min(0).max(100)
});
export type CategoryScore = z.infer<typeof CategoryScoreSchema>;

export const ProjectContextSchema = z.object({
  company: z.string(),
  canonicalUrl: z.string().url(),
  businessModel: z.string().optional(),
  category: z.string().optional(),
  product: z.string().optional(),
  targetAudience: z.array(z.string()).default([]),
  market: z.array(z.string()).default([]),
  primaryConversion: z.string().optional(),
  language: z.string().optional(),
  confidence: z.number().min(0).max(1)
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

export const AuditScopeSchema = z.object({
  pagesAnalyzed: z.number().int().min(1),
  pages: z.array(z.object({
    url: z.string().url(),
    kind: z.string(),
    title: z.string().optional()
  })),
  performanceAvailable: z.boolean(),
  performanceSource: z.enum(["pagespeed_lab", "unavailable"])
});
export type AuditScope = z.infer<typeof AuditScopeSchema>;

export const AuditReportSchema = z.object({
  audit: z.object({ id: z.string(), completedAt: z.string(), version: z.string() }),
  project: ProjectContextSchema,
  summary: z.object({
    observedScore: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    coverage: z.number().min(0).max(100),
    growthPotential: z.enum(["unknown", "low", "medium", "high"])
  }),
  scope: AuditScopeSchema.optional(),
  categories: z.array(CategoryScoreSchema),
  checks: z.array(AuditCheckSchema),
  evidence: z.array(EvidenceSchema),
  findings: z.array(FindingSchema),
  rootCauses: z.array(RootCauseSchema).default([]),
  priorities: z.array(RecommendationSchema)
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

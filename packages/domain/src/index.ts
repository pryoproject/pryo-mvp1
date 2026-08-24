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

export const MarketKeywordSchema = z.object({
  keyword: z.string(),

  // Legacy DataForSEO fields kept for old reports.
  searchVolume: z.number().nonnegative().optional(),
  cpc: z.number().nonnegative().optional(),
  competition: z.string().optional(),
  competitionIndex: z.number().min(0).max(100).optional(),
  monthlyTrendPct: z.number().optional(),

  // Brave Market Lite fields.
  targetPosition: z.number().int().positive().optional(),
  resultCount: z.number().int().nonnegative().optional(),
  competitorCount: z.number().int().nonnegative().optional(),
  competitiveDensity: z.enum(["low", "medium", "high"]).optional()
});
export type MarketKeyword = z.infer<typeof MarketKeywordSchema>;

export const SearchCompetitorSchema = z.object({
  domain: z.string(),

  // Legacy field. In Brave reports it mirrors sampled-query appearances.
  intersections: z.number().int().nonnegative(),
  avgPosition: z.number().nonnegative().optional(),
  organicKeywords: z.number().int().nonnegative().optional(),
  organicEtv: z.number().nonnegative().optional(),

  appearances: z.number().int().nonnegative().optional(),
  sharePct: z.number().min(0).max(100).optional(),
  bestPosition: z.number().int().positive().optional(),
  queries: z.array(z.string()).default([]),
  sampleTitle: z.string().optional(),
  sampleUrl: z.string().url().optional()
});
export type SearchCompetitor = z.infer<typeof SearchCompetitorSchema>;

export const KeywordGapSchema = z.object({
  competitorDomain: z.string(),
  keyword: z.string(),

  // Legacy DataForSEO fields kept for old reports.
  searchVolume: z.number().nonnegative().optional(),
  cpc: z.number().nonnegative().optional(),

  competitorPosition: z.number().nonnegative().optional(),
  resultUrl: z.string().url().optional()
});
export type KeywordGap = z.infer<typeof KeywordGapSchema>;

export const MarketIntelligenceSchema = z.object({
  available: z.boolean(),
  provider: z.enum(["brave", "dataforseo", "unavailable"]),
  targetDomain: z.string(),
  locationName: z.string(),
  languageName: z.string(),
  keywords: z.array(MarketKeywordSchema).default([]),
  competitors: z.array(SearchCompetitorSchema).default([]),
  gaps: z.array(KeywordGapSchema).default([]),
  queryCount: z.number().int().nonnegative().default(0),
  successfulQueries: z.number().int().nonnegative().default(0),
  fetchedAt: z.string(),
  errorCode: z.enum(["NOT_CONFIGURED", "PROVIDER_ERROR"]).optional()
});
export type MarketIntelligence = z.infer<typeof MarketIntelligenceSchema>;

export const AuditScopeSchema = z.object({
  pagesAnalyzed: z.number().int().min(1),
  pages: z.array(z.object({
    url: z.string().url(),
    kind: z.string(),
    title: z.string().optional()
  })),
  performanceAvailable: z.boolean(),
  performanceSource: z.enum(["pagespeed_lab", "unavailable"]),
  marketAvailable: z.boolean().default(false),
  marketSource: z.enum(["brave", "dataforseo", "unavailable"]).default("unavailable")
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
  market: MarketIntelligenceSchema.optional(),
  categories: z.array(CategoryScoreSchema),
  checks: z.array(AuditCheckSchema),
  evidence: z.array(EvidenceSchema),
  findings: z.array(FindingSchema),
  rootCauses: z.array(RootCauseSchema).default([]),
  priorities: z.array(RecommendationSchema)
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

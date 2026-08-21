export interface ScorableCheck {
  score: number;
  confidence: number;
  weight: number;
  available?: boolean;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ice(impact: number, confidence: number, ease: number) {
  return Math.round(clamp(impact, 1, 10) * clamp(confidence, 1, 10) * clamp(ease, 1, 10));
}

export function priorityScore(iceScore: number, urgency = 1, unlock = 1) {
  return clamp(Math.round((clamp(iceScore, 0, 1000) / 1000) * 100 * urgency * unlock), 0, 100);
}

export function weightedHealth(checks: ScorableCheck[]) {
  const available = checks.filter((check) => check.available !== false && check.weight > 0);
  const totalWeight = available.reduce((sum, check) => sum + check.weight, 0);
  if (!totalWeight) return 0;
  return Math.round(available.reduce((sum, check) => sum + clamp(check.score, 0, 100) * check.weight, 0) / totalWeight);
}

export function weightedConfidence(checks: ScorableCheck[]) {
  const available = checks.filter((check) => check.available !== false && check.weight > 0);
  const totalWeight = available.reduce((sum, check) => sum + check.weight, 0);
  if (!totalWeight) return 0;
  return Math.round(available.reduce((sum, check) => sum + clamp(check.confidence, 0, 1) * 100 * check.weight, 0) / totalWeight);
}

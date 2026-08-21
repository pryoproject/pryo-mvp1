export function ice(impact: number, confidence: number, ease: number) {
  return impact * confidence * ease;
}

export function priorityScore(iceScore: number, urgency = 1, unlock = 1) {
  return Math.min(100, Math.round((iceScore / 1000) * 100 * urgency * unlock));
}

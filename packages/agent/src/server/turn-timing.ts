export interface TurnTimingSummary {
  elapsedMs: number;
  toolMs: number;
  inferenceMs: number;
  outputTokens: number;
  usageComplete: boolean;
}

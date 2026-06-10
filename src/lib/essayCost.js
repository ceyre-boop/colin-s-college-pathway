// Model selection + cost estimation for essay drafting. Shared by the server (picks the model,
// computes real cost from token usage) and the client (shows an estimate before generating).

// $ per 1M tokens (Anthropic list pricing).
export const PRICING = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
};

export const DEFAULT_MODEL = 'claude-haiku-4-5';

// Token-minimal policy: Haiku for everything except high-value scholarships, where a better
// essay is worth the extra cents — Tier-3 ("long" priority) or amount >= $7,500.
export function pickModel(scholarship) {
  const amount = Number(scholarship?.amount || 0);
  const highValue = scholarship?.priority === 'long' || amount >= 7500;
  return highValue ? 'claude-sonnet-4-6' : DEFAULT_MODEL;
}

export function costUsd(usage, model) {
  const p = PRICING[model] ?? PRICING[DEFAULT_MODEL];
  const inTok = Number(usage?.input_tokens ?? 0);
  const outTok = Number(usage?.output_tokens ?? 0);
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

// Rough pre-generation estimate (no usage yet): ~700 input + ~700 output tokens per essay.
export function estimateBatchCost(scholarships) {
  return scholarships.reduce((sum, s) => {
    const p = PRICING[pickModel(s)];
    return sum + (700 / 1e6) * p.in + (700 / 1e6) * p.out;
  }, 0);
}

export const fmtUsd = (n) =>
  n < 0.01 ? `<$0.01` : `$${n.toFixed(n < 1 ? 3 : 2)}`;

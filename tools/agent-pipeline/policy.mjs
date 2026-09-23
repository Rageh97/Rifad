import Ajv from 'ajv';

export const budgets = Object.freeze({
  LOW: { builder: { soft: 20_000, hard: 40_000 }, verifier: null, totalHard: 40_000, maxVerifyFix: 0, maxCiFix: 2 },
  STANDARD: { builder: { soft: 50_000, hard: 80_000 }, verifier: { soft: 30_000, hard: 50_000 }, totalHard: 120_000, maxVerifyFix: 2, maxCiFix: 2 },
  CRITICAL: { builder: { soft: 70_000, hard: 110_000 }, verifier: { soft: 50_000, hard: 80_000 }, totalHard: 170_000, maxVerifyFix: 2, maxCiFix: 2 },
});

const schema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'taskId', 'risk', 'objective', 'acceptance', 'allowedPaths', 'baseSha', 'baseBranch'],
  properties: {
    version: { const: 1 },
    taskId: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{2,63}$' },
    risk: { enum: ['LOW', 'STANDARD', 'CRITICAL'] },
    objective: { type: 'string', minLength: 12, maxLength: 4000 },
    acceptance: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 5, maxLength: 500 } },
    allowedPaths: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 240 } },
    baseSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    baseBranch: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$' },
  },
};

const validate = new Ajv({ allErrors: true }).compile(schema);

export function pathName(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error('INVALID_PATH');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part === '.git')) throw new Error('INVALID_PATH');
  return value;
}

export function loadTaskSpec(value) {
  if (!validate(value)) throw new Error('INVALID_TASK_SPEC: ' + validate.errors.map(error => error.instancePath + ' ' + error.message).join('; '));
  for (const pattern of value.allowedPaths) {
    const path = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
    pathName(path);
    if (path.includes('*') || path.includes('?')) throw new Error('INVALID_ALLOWED_PATH');
  }
  if (value.baseBranch.includes('..') || value.baseBranch.includes('//') || value.baseBranch.endsWith('/') || value.baseBranch.endsWith('.')) throw new Error('INVALID_BASE_BRANCH');
  return Object.freeze({ ...value, acceptance: Object.freeze([...value.acceptance]), allowedPaths: Object.freeze([...value.allowedPaths]) });
}

export function allowedPath(path, patterns) {
  pathName(path);
  return patterns.some(pattern => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
}

export function scopeResult(paths, patterns) {
  const unauthorized = [...new Set(paths)].filter(path => !allowedPath(path, patterns)).sort();
  return { ok: unauthorized.length === 0, unauthorized };
}

export class UsageLedger {
  constructor(risk) {
    if (!budgets[risk]) throw new Error('INVALID_RISK');
    this.policy = budgets[risk];
    this.used = { builder: 0, verifier: 0 };
    this.softReviews = [];
  }
  add(role, tokens) {
    if (!['builder', 'verifier'].includes(role) || !this.policy[role]) throw new Error('INVALID_ROLE');
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('MISSING_USAGE');
    this.used[role] += tokens;
    if (this.used[role] > this.policy[role].hard || this.used.builder + this.used.verifier > this.policy.totalHard) throw new Error('BUDGET_EXCEEDED');
  }
  beforeNext(role, forecast, progress) {
    if (!this.policy[role]) throw new Error('INVALID_ROLE');
    if (!Number.isSafeInteger(forecast) || forecast <= 0) throw new Error('INVALID_FORECAST');
    const remaining = this.policy[role].hard - this.used[role];
    const totalRemaining = this.policy.totalHard - this.used.builder - this.used.verifier;
    if (forecast > remaining || forecast > totalRemaining) throw new Error('BUDGET_EXCEEDED');
    if (this.used[role] >= this.policy[role].soft) {
      const review = { role, used: this.used[role], forecast, progress: Boolean(progress) };
      this.softReviews.push(review);
      if (!progress) throw new Error('HUMAN_REVIEW_REQUIRED');
      return review;
    }
    return null;
  }
}

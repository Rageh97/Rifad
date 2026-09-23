import { writeFileSync } from 'node:fs';

const transitions = {
  INIT: ['PREFLIGHT'],
  PREFLIGHT: ['BUILDING'],
  BUILDING: ['GATING'],
  GATING: ['CANDIDATE'],
  CANDIDATE: ['VERIFYING', 'VERIFIED'],
  VERIFYING: ['BUILDING', 'VERIFYING', 'VERIFIED'],
  VERIFIED: ['GATING_FINAL'],
  GATING_FINAL: ['CI_PENDING'],
  CI_PENDING: ['BUILDING', 'READY_FOR_APPROVAL'],
};

export const terminal = new Set([
  'READY_FOR_APPROVAL', 'SCOPE_VIOLATION', 'PROTOCOL_VIOLATION',
  'BUDGET_EXCEEDED', 'HUMAN_REVIEW_REQUIRED', 'BLOCKED',
]);
const failures = new Set([...terminal].filter(value => value !== 'READY_FOR_APPROVAL'));

export class RunState {
  constructor(path, taskId) {
    this.path = path;
    this.value = 'INIT';
    this.events = [{ state: 'INIT', at: new Date().toISOString(), taskId }];
    this.save();
  }
  to(next, detail = {}) {
    if (terminal.has(this.value)) throw new Error('TERMINAL_STATE');
    if (!failures.has(next) && !transitions[this.value]?.includes(next)) throw new Error(`INVALID_TRANSITION: ${this.value} -> ${next}`);
    this.value = next;
    this.events.push({ state: next, at: new Date().toISOString(), ...detail });
    this.save();
  }
  save() {
    writeFileSync(this.path, JSON.stringify({ status: this.value, events: this.events }, null, 2) + '\n');
  }
}

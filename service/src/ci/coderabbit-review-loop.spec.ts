import { decideFixLoopAction, MAX_FIX_ATTEMPTS } from './coderabbit-review-loop';

describe('decideFixLoopAction', () => {
  it('caps attempts at 1 (temporary captain override)', () => {
    expect(MAX_FIX_ATTEMPTS).toBe(1);
  });

  it('returns done when the verdict is approved at attempt 1, without ever attempting a fix', () => {
    expect(decideFixLoopAction(1, 'approved')).toBe('done');
  });

  it('returns done when approved at a later attempt too', () => {
    expect(decideFixLoopAction(2, 'approved')).toBe('done');
  });

  it('runs autofix on attempt 1 when changes are requested', () => {
    expect(decideFixLoopAction(1, 'changes_requested')).toBe('run_autofix');
  });

  it('escalates when changes are still requested after attempt 1 is re-reviewed', () => {
    expect(decideFixLoopAction(2, 'changes_requested')).toBe('escalate');
  });

  it('never falls back to self_fix once the (reduced) cap is exhausted', () => {
    expect(decideFixLoopAction(3, 'changes_requested')).toBe('escalate');
  });

  it.each([1, 2, 3])(
    'stays open on a pending/rate-limited verdict without escalating or consuming an attempt (attempt %i)',
    (attempt) => {
      expect(decideFixLoopAction(attempt, 'pending')).toBe('wait');
    },
  );

  it('does not report pending as done', () => {
    expect(decideFixLoopAction(1, 'pending')).not.toBe('done');
  });

  it('generalizes to the spec-defined 3-attempt loop when maxAttempts is raised back', () => {
    expect(decideFixLoopAction(1, 'changes_requested', 3)).toBe('run_autofix');
    expect(decideFixLoopAction(2, 'changes_requested', 3)).toBe('self_fix');
    expect(decideFixLoopAction(3, 'changes_requested', 3)).toBe('self_fix');
    expect(decideFixLoopAction(4, 'changes_requested', 3)).toBe('escalate');
  });
});

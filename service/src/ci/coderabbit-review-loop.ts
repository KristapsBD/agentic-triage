/**
 * Bounded fix-loop decision logic for the ship-flow crewmate's CodeRabbit
 * review loop (issue #56). Pure function so the "have we hit the attempt cap"
 * and "did CodeRabbit's last review request changes, approve, or not run yet"
 * checks are unit-tested the same way as this repo's other decision logic
 * (duplicate-verdict.ts, confidence.ts, retry.ts), rather than left as inline
 * conditionals in the crewmate's own reasoning.
 *
 * `pending` is its own verdict state, distinct from `changes_requested`: the
 * fix loop re-triggers review after every fix, and CodeRabbit's plan allows
 * only ~1 included review per hour (observed on PR #55), so a re-review can
 * still be running -- or rate-limited -- when the crewmate checks. Reading
 * that as `changes_requested` would misreport a review that hasn't run yet
 * as still-failing.
 */

export type ReviewVerdict = 'approved' | 'changes_requested' | 'pending';

export type FixLoopDecision = 'run_autofix' | 'self_fix' | 'escalate' | 'done' | 'wait';

/**
 * Spec (issue #56) caps this loop at 3 attempts: 1 `autofix` try + 2 self-fix
 * tries. Temporarily reduced to 1 by captain's override: the plan's ~1
 * included review per hour means a 3-attempt loop can't get 3 fresh reviews
 * inside the rate limit. Raising this back to 3 is a one-line change.
 */
export const MAX_FIX_ATTEMPTS = 1;

function decideForChangesRequested(attemptNumber: number, maxAttempts: number): FixLoopDecision {
  if (attemptNumber > maxAttempts) {
    return 'escalate';
  }
  return attemptNumber === 1 ? 'run_autofix' : 'self_fix';
}

export function decideFixLoopAction(
  attemptNumber: number,
  verdict: ReviewVerdict,
  maxAttempts: number = MAX_FIX_ATTEMPTS,
): FixLoopDecision {
  if (verdict === 'pending') {
    return 'wait';
  }
  if (verdict === 'approved') {
    return 'done';
  }
  return decideForChangesRequested(attemptNumber, maxAttempts);
}

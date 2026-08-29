export interface GiteaIssueSummary {
  number: number;
  title: string;
}

/**
 * Resolves a single target issue for `titleSubstring` out of `issues`.
 *
 * Prefers an exact (case-insensitive) title match over a mere substring
 * match, then falls back to substring matches broken by shortest title --
 * Gitea's list order isn't title order, and a later Set C bundled-report
 * title can otherwise contain this same substring alongside unrelated text
 * and get matched first (found via a live run: B5's "Login button
 * unresponsive" substring also matched a bundled report's longer title once
 * Set C had run).
 *
 * Throws instead of silently guessing whenever a tier still has more than
 * one candidate -- e.g. two leftover synthetic issues tied with the real
 * seed issue at the same title length -- so a genuine collision surfaces as
 * a clear eval-harness error instead of a mysterious wrong-target failure.
 */
export function resolveGiteaIssueByTitle(issues: GiteaIssueSummary[], titleSubstring: string): number | null {
  const needle = titleSubstring.toLowerCase();

  const exactMatches = issues.filter((issue) => issue.title.toLowerCase() === needle);
  if (exactMatches.length === 1) return exactMatches[0].number;
  if (exactMatches.length > 1) {
    throw new Error(
      `ambiguous exact title match for ${JSON.stringify(titleSubstring)}: issues #${exactMatches.map((i) => i.number).join(', #')}`,
    );
  }

  const substringMatches = issues.filter((issue) => issue.title.toLowerCase().includes(needle));
  if (substringMatches.length === 0) return null;

  const shortestLength = Math.min(...substringMatches.map((issue) => issue.title.length));
  const shortest = substringMatches.filter((issue) => issue.title.length === shortestLength);
  if (shortest.length > 1) {
    throw new Error(
      `ambiguous substring title match for ${JSON.stringify(titleSubstring)}: issues #${shortest.map((i) => i.number).join(', #')} all tied at length ${shortestLength}`,
    );
  }
  return shortest[0].number;
}

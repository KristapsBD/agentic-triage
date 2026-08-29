/** Regression coverage for the Set B eval harness's issue-title tie-break (finding: leftover synthetic issues tying the real seed issue's title length previously caused a silent wrong-target match). */

import { GiteaIssueSummary, resolveGiteaIssueByTitle } from './gitea-issue-resolution';

describe('resolveGiteaIssueByTitle', () => {
  it('resolves an unambiguous substring match', () => {
    const issues: GiteaIssueSummary[] = [{ number: 1, title: 'Login button unresponsive on mobile Safari' }];
    expect(resolveGiteaIssueByTitle(issues, 'Login button unresponsive')).toBe(1);
  });

  it('returns null when nothing matches', () => {
    const issues: GiteaIssueSummary[] = [{ number: 1, title: 'Totally unrelated title' }];
    expect(resolveGiteaIssueByTitle(issues, 'Login button unresponsive')).toBeNull();
  });

  it('prefers an exact case-insensitive title match over same-length substring matches', () => {
    const issues: GiteaIssueSummary[] = [
      { number: 1, title: 'Login button unresponsive on mobile Safari' },
      { number: 21, title: 'Login button unresponsive on Settings page' },
      { number: 22, title: 'Login button unresponsive on Settings page' },
    ];
    expect(resolveGiteaIssueByTitle(issues, 'Login button unresponsive on mobile Safari')).toBe(1);
  });

  it('throws instead of silently picking a title when substring matches tie at the same length', () => {
    // Real-world regression: leftover synthetic acme-app issues (#21/#22)
    // tied at the same title length as the real Set A seed issue (#1), so
    // the old shortest-title tie-break silently resolved to the wrong
    // (synthetic) issue depending on Gitea's list ordering.
    const issues: GiteaIssueSummary[] = [
      { number: 21, title: 'Login button unresponsive on Settings page' },
      { number: 1, title: 'Login button unresponsive on mobile Safari' },
    ];
    expect(() => resolveGiteaIssueByTitle(issues, 'Login button unresponsive')).toThrow(/ambiguous/i);
  });

  it('throws when multiple issues share the exact same title', () => {
    const issues: GiteaIssueSummary[] = [
      { number: 21, title: 'Login button unresponsive on Settings page' },
      { number: 22, title: 'Login button unresponsive on Settings page' },
    ];
    expect(() => resolveGiteaIssueByTitle(issues, 'Login button unresponsive on Settings page')).toThrow(/ambiguous/i);
  });
});

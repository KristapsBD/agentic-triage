# Duplicate Verdict is three-tier, not a boolean

Judging a Raw Report against its Duplicate Candidates produces one of three outcomes —
clear duplicate, possible duplicate, or not a duplicate — rather than a single
duplicate/not-duplicate boolean.

The brief calls out avoiding *false* merges as a success criterion. A boolean forces a
coin-flip exactly at the threshold boundary: a clear duplicate skips issue creation and
comments on the existing issue, a possible duplicate still creates a fresh issue but
cross-links and Review Flags it, and a confident non-match creates a fresh issue
normally. The middle tier is what keeps a borderline match from silently merging into
the wrong issue.

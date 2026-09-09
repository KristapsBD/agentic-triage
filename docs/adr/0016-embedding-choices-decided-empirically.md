# Embedding text and model choice are decided empirically against our own evidence, not by symmetry assumptions or benchmark rank

Duplicate retrieval originally embedded the raw, unextracted report against an existing issue's
fully-formatted Gitea body — not a like-for-like comparison, even though extraction already runs
first in the pipeline and a comparable representation was available. Retrieval only needs to
shortlist candidates for the LLM judgment step, which sees full context regardless, so the
embedding stage's job is precision on both sides of the comparison, not maximal detail.

We add a concise `summary` field to extraction, distinct from `title`, and embed
`title + summary` against `title + body` on the existing-issue side. Model choice follows the
same evidence-first standard already established for the similarity floor
(`tune-duplicate-floor.ts`, tuned against Set A's near-miss cases): a candidate model is adopted
only after it's measured against our own corpus, never chosen off a general leaderboard. The
embedding cache records which model produced each stored vector, so a future swap can
distinguish stale-model rows rather than comparing incompatible vectors, and multiple models'
vectors may coexist during a transition.

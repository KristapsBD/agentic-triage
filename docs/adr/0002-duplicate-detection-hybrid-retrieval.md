# Duplicate detection: embedding retrieval + LLM pairwise judgment

Duplicate detection retrieves top-K Duplicate Candidates via embedding similarity
against existing open issues, then has the LLM make a pairwise same-bug judgment only
on that narrowed set.

Considered: LLM-only (handing the model the full open-issue list) doesn't scale past a
handful of issues and is more prone to missed or hallucinated matches with no retrieval
floor under it. Pure lexical/keyword matching is too brittle for paraphrased duplicates
— e.g. "login button does nothing when tapped" vs. "tap the login button and literally
nothing happens" share almost no exact tokens. Retrieval narrows the field cheaply and
consistently; the LLM is far more reliable at a bounded per-candidate judgment than at
open-ended "is this a duplicate of anything in this list."

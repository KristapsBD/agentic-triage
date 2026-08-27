"""Local sentence-transformers embeddings for Duplicate Candidate retrieval.

No external embeddings API dependency, per the spec's stack decision.
"""

from __future__ import annotations

import numpy as np
from sentence_transformers import SentenceTransformer

from app.schemas import DuplicateCandidate, GiteaIssue


class EmbeddingIndex:
    def __init__(self, model_name: str, similarity_floor: float, top_k: int):
        self._model = SentenceTransformer(model_name)
        self._floor = similarity_floor
        self._top_k = top_k

    def find_candidates(self, raw_report: str, open_issues: list[GiteaIssue]) -> list[DuplicateCandidate]:
        if not open_issues:
            return []
        texts = [f"{issue.title}\n{issue.body}" for issue in open_issues]
        embeddings = self._model.encode([raw_report, *texts], normalize_embeddings=True)
        report_vec, issue_vecs = embeddings[0], embeddings[1:]
        similarities = issue_vecs @ report_vec

        scored = sorted(zip(open_issues, similarities), key=lambda pair: pair[1], reverse=True)
        candidates = [
            DuplicateCandidate(issue_number=issue.number, title=issue.title, body=issue.body, similarity=float(sim))
            for issue, sim in scored
            if sim >= self._floor
        ]
        return candidates[: self._top_k]

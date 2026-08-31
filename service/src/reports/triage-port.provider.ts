/**
 * Composes the real Gitea client, LLM client, embedding index, and Decision
 * Store into one TriagePort implementation — the TS equivalent of
 * app/real_port.py's composition.
 */

import { Provider } from '@nestjs/common';
import { DecisionStore } from '../decisions/decision-store';
import { EmbeddingIndex } from '../embeddings/embedding-index';
import { GiteaClient } from '../gitea/gitea-client';
import { LlmClient } from '../llm/llm-client';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';

export const triagePortProvider: Provider = {
  provide: TRIAGE_PORT,
  useFactory: (gitea: GiteaClient, llm: LlmClient, embeddings: EmbeddingIndex, decisions: DecisionStore): TriagePort => ({
    createIssue: (title, body, labels) => gitea.createIssue(title, body, labels),
    commentIssue: (issueNumber, body) => gitea.commentIssue(issueNumber, body),
    listOpenIssues: () => gitea.listOpenIssues(),
    extract: (rawReport, feedback) => llm.extract(rawReport, feedback),
    findCandidates: (rawReport, openIssues) => embeddings.findCandidates(rawReport, openIssues),
    judgeDuplicate: (rawReport, candidate, feedback) => llm.judgeDuplicate(rawReport, candidate, feedback),
    saveDecisionRecord: (record) => Promise.resolve(decisions.save(record)),
    getDecisionRecord: (reportHash) => Promise.resolve(decisions.get(reportHash)),
    claimDecisionRecord: (record) => Promise.resolve(decisions.tryClaim(record)),
  }),
  inject: [GiteaClient, LlmClient, EmbeddingIndex, DecisionStore],
};

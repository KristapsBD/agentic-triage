/**
 * Composes the real Gitea client, LLM client, and embedding index into one
 * TriagePort implementation — the TS equivalent of app/real_port.py's
 * composition. The Decision Record methods are stubbed until #33
 * (idempotency) adds a DecisionStore provider here in their place.
 */

import { Provider } from '@nestjs/common';
import { EmbeddingIndex } from '../embeddings/embedding-index';
import { GiteaClient } from '../gitea/gitea-client';
import { LlmClient } from '../llm/llm-client';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';

function notImplemented(method: string, ticket: string): Promise<never> {
  return Promise.reject(new Error(`TriagePort.${method} is not implemented yet (${ticket})`));
}

export const triagePortProvider: Provider = {
  provide: TRIAGE_PORT,
  useFactory: (gitea: GiteaClient, llm: LlmClient, embeddings: EmbeddingIndex): TriagePort => ({
    createIssue: (title, body, labels) => gitea.createIssue(title, body, labels),
    commentIssue: (issueNumber, body) => gitea.commentIssue(issueNumber, body),
    listOpenIssues: () => gitea.listOpenIssues(),
    extract: (rawReport, feedback) => llm.extract(rawReport, feedback),
    findCandidates: (rawReport, openIssues) => embeddings.findCandidates(rawReport, openIssues),
    judgeDuplicate: (rawReport, candidate) => llm.judgeDuplicate(rawReport, candidate),
    saveDecisionRecord: () => notImplemented('saveDecisionRecord', 'ticket #33'),
    getDecisionRecord: () => notImplemented('getDecisionRecord', 'ticket #33'),
  }),
  inject: [GiteaClient, LlmClient, EmbeddingIndex],
};

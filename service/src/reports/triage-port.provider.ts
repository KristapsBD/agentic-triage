/**
 * Composes the real Gitea client into one TriagePort implementation — the TS
 * equivalent of app/real_port.py's composition. The LLM/embedding and
 * Decision Record methods are stubbed until their owning tickets (#28
 * extraction, #30 duplicate detection, #33 idempotency) add LlmClient,
 * EmbeddingIndex, and DecisionStore providers here in their place.
 */

import { Provider } from '@nestjs/common';
import { GiteaClient } from '../gitea/gitea-client';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';

function notImplemented(method: string, ticket: string): Promise<never> {
  return Promise.reject(new Error(`TriagePort.${method} is not implemented yet (${ticket})`));
}

export const triagePortProvider: Provider = {
  provide: TRIAGE_PORT,
  useFactory: (gitea: GiteaClient): TriagePort => ({
    createIssue: (title, body, labels) => gitea.createIssue(title, body, labels),
    commentIssue: (issueNumber, body) => gitea.commentIssue(issueNumber, body),
    listOpenIssues: () => gitea.listOpenIssues(),
    extract: () => notImplemented('extract', 'ticket #28'),
    findCandidates: () => notImplemented('findCandidates', 'ticket #30'),
    judgeDuplicate: () => notImplemented('judgeDuplicate', 'ticket #30'),
    saveDecisionRecord: () => notImplemented('saveDecisionRecord', 'ticket #33'),
    getDecisionRecord: () => notImplemented('getDecisionRecord', 'ticket #33'),
  }),
  inject: [GiteaClient],
};

/**
 * Regression guard for F2 (scout-hire-audit-opus): triagePortProvider is
 * the real DI composition that wires GiteaClient/LlmClient/EmbeddingIndex/
 * DecisionStore into a TriagePort. Every other duplicate-judgment retry
 * test (retry-budgets.spec.ts) drives FakeTriagePort directly, which
 * implements TriagePort's judgeDuplicate(rawReport, candidate, feedback)
 * itself and so cannot see a composition bug where the real factory drops
 * the third argument on the way to LlmClient. This test instead calls the
 * provider's actual useFactory, the way Nest's DI container does, so a
 * regression here fails exactly the seam the fake cannot reach.
 */

import { DecisionStore } from '../decisions/decision-store';
import { EmbeddingIndex } from '../embeddings/embedding-index';
import { GiteaClient } from '../gitea/gitea-client';
import { LlmClient } from '../llm/llm-client';
import { triagePortProvider } from './triage-port.provider';
import { TriagePort } from './triage-port.interface';
import { DuplicateCandidate } from './types';

describe('triagePortProvider (real DI composition)', () => {
  it('forwards the validation-retry feedback argument through to LlmClient.judgeDuplicate', async () => {
    const judgeDuplicate = jest
      .fn()
      .mockResolvedValue({ judgment: { same_bug: 'yes', rationale: 'r' }, usage: { input_tokens: 1, output_tokens: 1 } });
    const fakeLlm = { extract: jest.fn(), judgeDuplicate } as unknown as LlmClient;
    const fakeGitea = {} as unknown as GiteaClient;
    const fakeEmbeddings = {} as unknown as EmbeddingIndex;
    const fakeDecisions = {} as unknown as DecisionStore;

    const useFactory = (
      triagePortProvider as {
        useFactory: (gitea: GiteaClient, llm: LlmClient, embeddings: EmbeddingIndex, decisions: DecisionStore) => TriagePort;
      }
    ).useFactory;

    const port = useFactory(fakeGitea, fakeLlm, fakeEmbeddings, fakeDecisions);

    const candidate: DuplicateCandidate = { issue_number: 1, title: 't', body: 'b', similarity: 0.9, labels: [] };
    await port.judgeDuplicate('raw report', candidate, 'same_bug: invalid enum value');

    expect(judgeDuplicate).toHaveBeenCalledWith('raw report', candidate, 'same_bug: invalid enum value');
  });
});

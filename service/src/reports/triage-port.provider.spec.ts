/**
 * Regression test for F1 (skeptical audit `scout-hire-audit-fable`): the real
 * `triagePortProvider` factory must forward the `feedback` argument on
 * `judgeDuplicate` through to `LlmClient.judgeDuplicate`, not just the fake
 * port used by every other spec. Exercises the actual factory function, not
 * `FakeTriagePort`.
 */

import { FactoryProvider } from '@nestjs/common';
import { DecisionStore } from '../decisions/decision-store';
import { EmbeddingIndex } from '../embeddings/embedding-index';
import { GiteaClient } from '../gitea/gitea-client';
import { LlmClient } from '../llm/llm-client';
import { DuplicateCandidate } from './types';
import { triagePortProvider } from './triage-port.provider';
import { TriagePort } from './triage-port.interface';

describe('triagePortProvider (real DI composition)', () => {
  it('forwards the feedback argument from judgeDuplicate through to LlmClient.judgeDuplicate', async () => {
    const judgeDuplicate = jest.fn().mockResolvedValue({
      judgment: { same_bug: 'no', rationale: 'unrelated' },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const fakeLlm = { judgeDuplicate } as unknown as LlmClient;
    const fakeGitea = {} as GiteaClient;
    const fakeEmbeddings = {} as EmbeddingIndex;
    const fakeDecisions = {} as DecisionStore;

    const factory = (triagePortProvider as FactoryProvider).useFactory;
    const port: TriagePort = factory(fakeGitea, fakeLlm, fakeEmbeddings, fakeDecisions);

    const candidate: DuplicateCandidate = {
      issue_number: 3,
      title: 'existing issue',
      body: 'body',
      similarity: 0.9,
    };
    await port.judgeDuplicate('raw report text', candidate, 'invalid enum value: "maybe"');

    expect(judgeDuplicate).toHaveBeenCalledWith(
      'raw report text',
      candidate,
      'invalid enum value: "maybe"',
    );
  });
});

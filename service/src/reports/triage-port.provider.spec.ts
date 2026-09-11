/**
 * Regression guard for F2 (scout-hire-audit-opus) / F1 (scout-hire-audit-fable):
 * triagePortProvider is the real DI composition that wires GiteaClient/LlmClient/
 * EmbeddingIndex/DecisionStore into a TriagePort. Every other duplicate-judgment
 * retry test (retry-budgets.spec.ts) drives FakeTriagePort directly, which
 * implements TriagePort's judgeDuplicate(rawReport, candidate, feedback) itself
 * and so cannot see a composition bug where the real factory drops the third
 * argument on the way to LlmClient. This test instead calls the provider's
 * actual useFactory, the way Nest's DI container does, so a regression here
 * fails exactly the seam the fake cannot reach.
 */

import { DecisionStore } from '../decisions/decision-store';
import { EmbeddingIndex } from '../embeddings/embedding-index';
import { GiteaClient } from '../gitea/gitea-client';
import { LlmClient } from '../llm/llm-client';
import { triagePortProvider } from './triage-port.provider';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';
import { DuplicateCandidate, GiteaIssue } from './types';

type FactoryProvider = {
  provide: unknown;
  useFactory: (gitea: GiteaClient, llm: LlmClient, embeddings: EmbeddingIndex, decisions: DecisionStore) => TriagePort;
  inject: unknown[];
};

describe('triagePortProvider (real DI composition)', () => {
  type PortOverrides = {
    gitea: Partial<GiteaClient>;
    llm: Partial<LlmClient>;
    embeddings: Partial<EmbeddingIndex>;
    decisions: Partial<DecisionStore>;
  };

  const defaultOverrides: PortOverrides = { gitea: {}, llm: {}, embeddings: {}, decisions: {} };

  const buildPort = (overrides: Partial<PortOverrides> = {}): TriagePort => {
    const merged = { ...defaultOverrides, ...overrides };
    const useFactory = (triagePortProvider as FactoryProvider).useFactory;

    return useFactory(
      merged.gitea as GiteaClient,
      merged.llm as LlmClient,
      merged.embeddings as EmbeddingIndex,
      merged.decisions as DecisionStore,
    );
  };

  it('declares the provider token and injection order the DI container relies on', () => {
    const provider = triagePortProvider as FactoryProvider;
    expect(provider.provide).toBe(TRIAGE_PORT);
    expect(provider.inject).toEqual([GiteaClient, LlmClient, EmbeddingIndex, DecisionStore]);
  });

  it('forwards the validation-retry feedback argument through to LlmClient.judgeDuplicate', async () => {
    const judgeDuplicate = jest
      .fn()
      .mockResolvedValue({ judgment: { same_bug: 'yes', rationale: 'r' }, usage: { input_tokens: 1, output_tokens: 1 } });
    const fakeLlm = { extract: jest.fn(), judgeDuplicate } as unknown as LlmClient;
    const fakeGitea = {} as unknown as GiteaClient;
    const fakeEmbeddings = {} as unknown as EmbeddingIndex;
    const fakeDecisions = {} as unknown as DecisionStore;

    const useFactory = (triagePortProvider as FactoryProvider).useFactory;

    const port = useFactory(fakeGitea, fakeLlm, fakeEmbeddings, fakeDecisions);

    const candidate: DuplicateCandidate = { issue_number: 1, title: 't', body: 'b', similarity: 0.9, labels: [] };
    await port.judgeDuplicate('raw report', candidate, 'same_bug: invalid enum value');

    expect(judgeDuplicate).toHaveBeenCalledWith('raw report', candidate, 'same_bug: invalid enum value');
  });

  it('forwards createIssue args to GiteaClient and returns its result', async () => {
    const createIssue = jest.fn().mockResolvedValue(42);
    const port = buildPort({ gitea: { createIssue } });

    const result = await port.createIssue('title', 'body', ['bug']);

    expect(createIssue).toHaveBeenCalledWith('title', 'body', ['bug']);
    expect(result).toBe(42);
  });

  it('forwards commentIssue args to GiteaClient and returns its result', async () => {
    const commentIssue = jest.fn().mockResolvedValue(undefined);
    const port = buildPort({ gitea: { commentIssue } });

    await port.commentIssue(7, 'a comment');

    expect(commentIssue).toHaveBeenCalledWith(7, 'a comment');
  });

  it('delegates listOpenIssues to GiteaClient and returns its result unchanged', async () => {
    const issues: GiteaIssue[] = [{ number: 1, title: 't', body: 'b', labels: [], state: 'open' }];
    const listOpenIssues = jest.fn().mockResolvedValue(issues);
    const port = buildPort({ gitea: { listOpenIssues } });

    const result = await port.listOpenIssues();

    expect(listOpenIssues).toHaveBeenCalledWith();
    expect(result).toBe(issues);
  });

  it('forwards extract args to LlmClient and returns its result', async () => {
    const extracted = { extraction: { title: 't' }, usage: { input_tokens: 1, output_tokens: 1 } };
    const extract = jest.fn().mockResolvedValue(extracted);
    const port = buildPort({ llm: { extract } });

    const result = await port.extract('raw report', 'feedback');

    expect(extract).toHaveBeenCalledWith('raw report', 'feedback');
    expect(result).toBe(extracted);
  });

  it('forwards findCandidates args to EmbeddingIndex and returns its result', async () => {
    const candidates: DuplicateCandidate[] = [{ issue_number: 2, title: 't', body: 'b', similarity: 0.5, labels: [] }];
    const findCandidates = jest.fn().mockResolvedValue(candidates);
    const openIssues: GiteaIssue[] = [{ number: 2, title: 't', body: 'b', labels: [], state: 'open' }];
    const port = buildPort({ embeddings: { findCandidates } });

    const result = await port.findCandidates('raw report', openIssues);

    expect(findCandidates).toHaveBeenCalledWith('raw report', openIssues);
    expect(result).toBe(candidates);
  });

  it('wraps DecisionStore.save (sync) in a resolved promise via saveDecisionRecord', async () => {
    const save = jest.fn();
    const port = buildPort({ decisions: { save } });
    const record = { report_hash: 'h' } as unknown as Parameters<TriagePort['saveDecisionRecord']>[0];

    await expect(port.saveDecisionRecord(record)).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledWith(record);
  });

  it('wraps DecisionStore.get (sync) in a resolved promise via getDecisionRecord', async () => {
    const stored = { report_hash: 'h' };
    const get = jest.fn().mockReturnValue(stored);
    const port = buildPort({ decisions: { get } });

    const result = await port.getDecisionRecord('h');

    expect(get).toHaveBeenCalledWith('h');
    expect(result).toBe(stored);
  });

  it('wraps DecisionStore.tryClaim (sync) in a resolved promise via claimDecisionRecord', async () => {
    const claimed = { report_hash: 'h' } as unknown as Parameters<TriagePort['claimDecisionRecord']>[0];
    const tryClaim = jest.fn().mockReturnValue(true);
    const port = buildPort({ decisions: { tryClaim } });

    const result = await port.claimDecisionRecord(claimed);

    expect(tryClaim).toHaveBeenCalledWith(claimed);
    expect(result).toBe(true);
  });
});

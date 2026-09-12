/**
 * The real extractor (`pipeline()` from @huggingface/transformers, backed by
 * onnxruntime-node's native addon) crashes Jest's sandboxed VM realm on an
 * internal `instanceof Float32Array` check -- see this module's own docblock
 * and service/AGENTS.md's "Quality gate" section. These specs mock only the
 * `pipeline()` call (the native inference seam) so embed()/findCandidates()'s
 * real logic -- caching, the similarity dot product, the floor filter,
 * sorting, and top-k slicing -- runs for real against fake fixed-size vectors.
 */

import { pipeline } from '@huggingface/transformers';
import { EmbeddingIndex } from './embedding-index';
import { GiteaIssue } from '../reports/types';
import { Settings } from '../config/settings';

jest.mock('@huggingface/transformers', () => ({ pipeline: jest.fn() }));

const mockedPipeline = pipeline as jest.Mock;

const settings: Settings = {
  gitea_url: 'http://gitea.local',
  gitea_repo_owner: 'triageadmin',
  gitea_repo_name: 'acme-app',
  gitea_token: 'x',
  anthropic_api_key: 'test-key',
  anthropic_model: 'claude-sonnet-5',
  decision_db_path: ':memory:',
  database_url: 'postgresql://triage:triage@localhost:5432/triage?schema=public',
  embedding_model_name: 'Xenova/all-MiniLM-L6-v2',
  duplicate_similarity_floor: 0.5,
  duplicate_top_k: 2,
  validation_retry_budget: 2,
  transient_retry_budget: 3,
  transient_retry_backoff_seconds: 0,
};

/** Maps fixed text->vector so the real dot-product logic sees deterministic similarities. */
function fakeExtractor(vectorsByText: Record<string, number[]>) {
  return jest.fn(async (text: string) => ({
    data: Float32Array.from(vectorsByText[text] ?? [0, 0]),
  }));
}

function issue(overrides: Partial<GiteaIssue> = {}): GiteaIssue {
  return { number: 1, title: 'title', body: 'body', labels: [], state: 'open', ...overrides };
}

beforeEach(() => {
  mockedPipeline.mockReset();
});

describe('EmbeddingIndex', () => {
  it('returns no candidates when there are no open issues, without touching the extractor', async () => {
    const index = new EmbeddingIndex(settings);

    const result = await index.findCandidates('a fresh report', []);

    expect(result).toEqual([]);
    expect(mockedPipeline).not.toHaveBeenCalled();
  });

  it('loads the extractor once and reuses it across multiple embed() calls', async () => {
    const extractor = fakeExtractor({
      report: [1, 0],
      'a\nb': [1, 0],
      'c\nd': [1, 0],
    });
    mockedPipeline.mockResolvedValue(extractor);
    const index = new EmbeddingIndex(settings);

    await index.findCandidates('report', [
      issue({ number: 1, title: 'a', body: 'b' }),
      issue({ number: 2, title: 'c', body: 'd' }),
    ]);

    expect(mockedPipeline).toHaveBeenCalledTimes(1);
    expect(mockedPipeline).toHaveBeenCalledWith('feature-extraction', settings.embedding_model_name);
    expect(extractor).toHaveBeenCalledTimes(3);
  });

  it('drops candidates below the similarity floor and keeps ones at or above it', async () => {
    const extractor = fakeExtractor({
      report: [1, 0],
      'close\nmatch': [1, 0],
      'unrelated\nstuff': [0, 1],
    });
    mockedPipeline.mockResolvedValue(extractor);
    const index = new EmbeddingIndex(settings);

    const result = await index.findCandidates('report', [
      issue({ number: 1, title: 'close', body: 'match' }),
      issue({ number: 2, title: 'unrelated', body: 'stuff' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].issue_number).toBe(1);
    expect(result[0].similarity).toBeCloseTo(1);
  });

  it('sorts remaining candidates by similarity descending and truncates to duplicate_top_k', async () => {
    const extractor = fakeExtractor({
      report: [1, 0],
      'low\nmatch': [0.6, 0.8],
      'mid\nmatch': [0.8, 0.6],
      'high\nmatch': [1, 0],
    });
    mockedPipeline.mockResolvedValue(extractor);
    const index = new EmbeddingIndex(settings);

    const result = await index.findCandidates('report', [
      issue({ number: 1, title: 'low', body: 'match' }),
      issue({ number: 2, title: 'mid', body: 'match' }),
      issue({ number: 3, title: 'high', body: 'match' }),
    ]);

    expect(result.map((c) => c.issue_number)).toEqual([3, 2]);
    expect(result).toHaveLength(settings.duplicate_top_k);
    expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
  });

  it('preserves title, body, and labels on returned candidates', async () => {
    const extractor = fakeExtractor({ report: [1, 0], 'a title\na body': [1, 0] });
    mockedPipeline.mockResolvedValue(extractor);
    const index = new EmbeddingIndex(settings);

    const result = await index.findCandidates('report', [
      issue({ number: 42, title: 'a title', body: 'a body', labels: ['bug', 'needs-triage'] }),
    ]);

    expect(result[0]).toEqual({
      issue_number: 42,
      title: 'a title',
      body: 'a body',
      similarity: 1,
      labels: ['bug', 'needs-triage'],
    });
  });
});

/**
 * Local @huggingface/transformers (ONNX runtime) embeddings for Duplicate
 * Candidate retrieval — no external embeddings API dependency (ADR-0002
 * carries over unchanged). Mirrors app/embeddings.py's EmbeddingIndex.
 *
 * The similarity floor (settings.duplicate_similarity_floor, default 0.35)
 * is a re-validated value, not copied from the Python build's
 * sentence-transformers tuning: computed against Set A (docs in
 * 2_candidate_sample_data.md) and its near-miss cases through this exact
 * model/runtime (Xenova/all-MiniLM-L6-v2 via @huggingface/transformers).
 * The clear-duplicate pair (B5 vs. EXIST-1) scored 0.65, both near-miss
 * cases scored 0.38-0.44 (clearing the floor so the LLM still gets to judge
 * them -- the floor is a retrieval cutoff, not the verdict itself), and
 * every genuinely unrelated Set A/B pair scored under 0.29 -- so 0.35
 * carries over as a floor that separates "worth asking the LLM about" from
 * "not even close" under the new runtime too. Reproduce with
 * `npm run tune:duplicate-floor` (scripts/tune-duplicate-floor.ts) --  not
 * a Jest spec, since onnxruntime-node's native addon fails an internal
 * `instanceof Float32Array` check inside Jest's sandboxed VM realm.
 */

import { Inject, Injectable } from '@nestjs/common';
import { pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { SETTINGS, Settings } from '../config/settings';
import { DuplicateCandidate, GiteaIssue } from '../reports/types';

function dot(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

@Injectable()
export class EmbeddingIndex {
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}

  private extractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractorPromise === null) {
      this.extractorPromise = pipeline('feature-extraction', this.settings.embedding_model_name);
    }
    return this.extractorPromise;
  }

  private async embed(text: string): Promise<Float32Array> {
    const extractor = await this.extractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return output.data as Float32Array;
  }

  async findCandidates(rawReport: string, openIssues: GiteaIssue[]): Promise<DuplicateCandidate[]> {
    if (openIssues.length === 0) return [];

    const reportVec = await this.embed(rawReport);
    const scored: DuplicateCandidate[] = [];
    for (const issue of openIssues) {
      const issueVec = await this.embed(`${issue.title}\n${issue.body}`);
      const similarity = dot(reportVec, issueVec);
      if (similarity >= this.settings.duplicate_similarity_floor) {
        scored.push({ issue_number: issue.number, title: issue.title, body: issue.body, similarity, labels: issue.labels });
      }
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, this.settings.duplicate_top_k);
  }
}

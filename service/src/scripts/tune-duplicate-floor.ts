/**
 * Ticket #30: reproducible evidence for the duplicate_similarity_floor value
 * (settings.ts, default 0.35) under this service's actual embedding library
 * (@huggingface/transformers), independent of the Python build's
 * sentence-transformers tuning.
 *
 * Not a Jest spec: onnxruntime-node's native addon does an `instanceof
 * Float32Array` check that fails inside Jest's sandboxed VM realm (each
 * test file gets its own global/intrinsics, so a typed array constructed
 * there isn't `instanceof` the addon's captured Float32Array) -- a known
 * class of incompatibility between native Node addons and Jest, not
 * something fixable from this module. Run standalone instead:
 *   npm run tune:duplicate-floor
 *
 * Prints each Set B / near-miss report's similarity against every Set A
 * issue (2_candidate_sample_data.md), so the floor can be eyeballed against
 * real output rather than assumed portable across embedding runtimes.
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { EmbeddingIndex } from '../embeddings/embedding-index';
import { loadSettings } from '../config/settings';
import {
  CLEAR_DUPLICATE_REPORT,
  NEAR_MISS_REPORTS,
  SET_A,
  UNRELATED_REPORT,
} from '../eval/fixtures';

const REPORTS: Record<string, string> = {
  [CLEAR_DUPLICATE_REPORT.name]: CLEAR_DUPLICATE_REPORT.text,
  [UNRELATED_REPORT.name]: UNRELATED_REPORT.text,
  ...Object.fromEntries(NEAR_MISS_REPORTS.map((r) => [r.name, r.text])),
};

async function main(): Promise<void> {
  const settings = loadSettings();
  const index = new EmbeddingIndex(settings);

  console.log(`duplicate_similarity_floor = ${settings.duplicate_similarity_floor}\n`);
  for (const [name, raw] of Object.entries(REPORTS)) {
    const candidates = await index.findCandidates(raw, SET_A);
    console.log(`${name}:`);
    if (candidates.length === 0) {
      console.log('  (nothing cleared the floor)');
    }
    for (const c of candidates) {
      console.log(
        `  #${c.issue_number} ${c.title.slice(0, 45).padEnd(45)} sim=${c.similarity.toFixed(4)}`,
      );
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Ticket #35: regression check for the embedding-library swap itself, not
 * pipeline/LLM logic. embedding-index.ts documents the floor-tuning
 * evidence this asserts on: a clear-duplicate pair scored ~0.65, both
 * near-miss cases scored 0.38-0.44 (clearing the retrieval floor so the LLM
 * still gets to judge them), and unrelated pairs scored under 0.29. This
 * turns that evidence into an assertion, so a regression introduced purely
 * by swapping embedding library/runtime/model (independent of any routing
 * logic change) fails loudly here instead of only showing up as a
 * hard-to-attribute Set B/C flake.
 *
 * Not a Jest spec, same onnxruntime-node/Jest sandboxed-VM incompatibility
 * documented in tune-duplicate-floor.ts. Run standalone:
 *   npm run verify:duplicate-thresholds
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { EmbeddingIndex } from '../embeddings/embedding-index';
import { loadSettings } from '../config/settings';
import { CLEAR_DUPLICATE_REPORT, NEAR_MISS_REPORTS, SET_A, UNRELATED_REPORT } from './fixtures';

// Above the near-miss band (0.38-0.44) and below the observed clear-duplicate
// score (~0.65) -- a regression that collapses the two bands together (e.g.
// a weaker embedding model) trips this even if the final tier still happens
// to route correctly today.
const CLEAR_BAND_MIN = 0.5;

interface CaseResult {
  id: string;
  failures: string[];
}

async function checkClearDuplicate(index: EmbeddingIndex): Promise<CaseResult> {
  const failures: string[] = [];
  const candidates = await index.findCandidates(CLEAR_DUPLICATE_REPORT.text, SET_A);
  const top = candidates[0];
  if (top === undefined) {
    failures.push(`no candidate cleared the retrieval floor at all (expected #${CLEAR_DUPLICATE_REPORT.targetIssueNumber})`);
  } else if (top.issue_number !== CLEAR_DUPLICATE_REPORT.targetIssueNumber) {
    failures.push(`expected top candidate #${CLEAR_DUPLICATE_REPORT.targetIssueNumber}, got #${top.issue_number} (sim=${top.similarity.toFixed(4)})`);
  } else if (top.similarity < CLEAR_BAND_MIN) {
    failures.push(`similarity ${top.similarity.toFixed(4)} fell below the clear-duplicate band (>= ${CLEAR_BAND_MIN})`);
  }
  return { id: CLEAR_DUPLICATE_REPORT.name, failures };
}

async function checkNearMiss(index: EmbeddingIndex, floor: number, nearMiss: { name: string; text: string }): Promise<CaseResult> {
  const failures: string[] = [];
  const candidates = await index.findCandidates(nearMiss.text, SET_A);
  const top = candidates[0];
  if (top === undefined) {
    failures.push(`no candidate cleared duplicate_similarity_floor=${floor} -- would never reach the LLM judge`);
  } else if (top.similarity >= CLEAR_BAND_MIN) {
    failures.push(`similarity ${top.similarity.toFixed(4)} rose into the clear-duplicate band (>= ${CLEAR_BAND_MIN}) -- false-merge risk`);
  }
  return { id: nearMiss.name, failures };
}

async function checkUnrelated(index: EmbeddingIndex): Promise<CaseResult> {
  const candidates = await index.findCandidates(UNRELATED_REPORT.text, SET_A);
  const failures =
    candidates.length > 0
      ? [`expected nothing to clear the floor, got ${candidates.map((c) => `#${c.issue_number}=${c.similarity.toFixed(4)}`).join(', ')}`]
      : [];
  return { id: UNRELATED_REPORT.name, failures };
}

async function main(): Promise<void> {
  const settings = loadSettings();
  const index = new EmbeddingIndex(settings);

  const results: CaseResult[] = [
    await checkClearDuplicate(index),
    ...(await Promise.all(NEAR_MISS_REPORTS.map((r) => checkNearMiss(index, settings.duplicate_similarity_floor, r)))),
    await checkUnrelated(index),
  ];

  console.log(`${'CASE'.padEnd(40)} RESULT`);
  console.log('-'.repeat(70));
  let passed = 0;
  for (const { id, failures } of results) {
    if (failures.length === 0) {
      console.log(`${id.padEnd(40)} PASS`);
      passed += 1;
    } else {
      console.log(`${id.padEnd(40)} FAIL`);
      for (const f of failures) console.log(`    - ${f}`);
    }
  }
  console.log('-'.repeat(70));
  console.log(`${passed}/${results.length} passed`);

  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

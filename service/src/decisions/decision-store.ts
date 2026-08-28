/**
 * SQLite-backed Decision Record persistence. Mirrors app/decision_store.py.
 *
 * Written in phases (pending -> processing -> completed/gitea_call_failed) so
 * a repeated POST of the same Raw Report can check for a prior record by
 * report hash before doing any LLM or Gitea work.
 */

import { Inject, Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { SETTINGS, Settings } from '../config/settings';
import { DecisionRecord } from '../reports/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decision_records (
  report_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
`;

@Injectable()
export class DecisionStore {
  private readonly db: Database.Database;

  constructor(@Inject(SETTINGS) settings: Settings) {
    this.db = new Database(settings.decision_db_path);
    this.db.exec(SCHEMA);
  }

  save(record: DecisionRecord): void {
    this.db
      .prepare(
        'INSERT INTO decision_records (report_hash, payload) VALUES (?, ?) ' +
          'ON CONFLICT(report_hash) DO UPDATE SET payload = excluded.payload',
      )
      .run(record.report_hash, JSON.stringify(record));
  }

  get(reportHash: string): DecisionRecord | null {
    const row = this.db.prepare('SELECT payload FROM decision_records WHERE report_hash = ?').get(reportHash) as
      | { payload: string }
      | undefined;
    if (row === undefined) return null;
    return JSON.parse(row.payload) as DecisionRecord;
  }
}

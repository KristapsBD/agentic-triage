/**
 * Postgres-backed (Prisma) Decision Record persistence (issue #59, replacing
 * the SQLite-backed implementation from before #58/#59). Mirrors
 * app/decision_store.py.
 *
 * Written in phases (pending -> processing -> completed/gitea_call_failed) so
 * a repeated POST of the same Raw Report can check for a prior record by
 * report hash before doing any LLM or Gitea work.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DecisionRecord } from '../reports/types';
import { fromDecisionRow, toDecisionCreateInput, toDecisionReplaceUpdateInput } from './decision-record.mapper';
import { PrismaService } from './prisma.service';

const INCLUDE_CHILDREN = {
  duplicateCandidates: true,
  tokenUsages: true,
  stageTimings: true,
} as const;

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class DecisionStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomic insert-or-bail (F3 audit finding: processReport's prior
   * get-then-save had an await point between the read and the write, so two
   * concurrent identical POSTs could both observe no existing record and
   * both proceed to do the LLM/Gitea work). The `report_hash` unique
   * constraint makes this atomic at the database level regardless of
   * concurrency -- returns whether this call actually created the row.
   */
  async tryClaim(record: DecisionRecord): Promise<boolean> {
    try {
      await this.prisma.decision.create({ data: toDecisionCreateInput(record) });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return false;
      throw error;
    }
  }

  async save(record: DecisionRecord): Promise<void> {
    await this.prisma.decision.upsert({
      where: { reportHash: record.report_hash },
      create: toDecisionCreateInput(record),
      update: toDecisionReplaceUpdateInput(record),
    });
  }

  async get(reportHash: string): Promise<DecisionRecord | null> {
    const row = await this.prisma.decision.findUnique({
      where: { reportHash },
      include: INCLUDE_CHILDREN,
    });
    return row ? fromDecisionRow(row) : null;
  }
}

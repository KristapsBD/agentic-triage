/**
 * Thin Nest lifecycle wrapper around the generated Prisma client (issue #59).
 * Deliberately does NOT eagerly `$connect()` in `onModuleInit` -- it keeps
 * the client's default lazy-connect-on-first-query behavior, so tests that
 * boot the app with a fake TriagePort (reports-http-wiring.spec.ts et al.)
 * never touch a real database just because DecisionsModule is in the graph.
 */

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SETTINGS, Settings } from '../config/settings';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(SETTINGS) settings: Settings) {
    super({ datasources: { db: { url: settings.database_url } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

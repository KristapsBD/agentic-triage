import * as path from 'path';
import * as dotenv from 'dotenv';

// Repo-wide convention: a single root .env, not a service-local one (see
// src/eval/*.ts, src/scripts/*.ts for the same pattern).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { defineConfig } from 'prisma/config';

// Same fallback `Settings` (src/config/settings.ts) uses for DATABASE_URL:
// `prisma generate` (unlike `migrate`/runtime queries) never needs a
// reachable database, only a syntactically valid URL, so this keeps `npm ci`
// (whose postinstall runs `prisma generate`) working in CI and other
// environments with no `.env`/DATABASE_URL present -- see issue #59.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url:
      process.env.DATABASE_URL ?? 'postgresql://triage:triage@localhost:5432/triage?schema=public',
  },
});

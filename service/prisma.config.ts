import * as path from 'path';
import * as dotenv from 'dotenv';

// Repo-wide convention: a single root .env, not a service-local one (see
// src/eval/*.ts, src/scripts/*.ts for the same pattern).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
  },
});

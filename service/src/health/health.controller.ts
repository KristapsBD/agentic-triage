/**
 * GET /health — mirrors app/main.py's health(): 200 once Gitea is reachable,
 * 503 otherwise, so docker-compose's healthcheck can gate on both services
 * being ready.
 */

import { Controller, Get, Inject, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { SETTINGS, Settings } from '../config/settings';

@Controller('health')
export class HealthController {
  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}

  @Get()
  async check(@Res() res: FastifyReply): Promise<void> {
    const giteaOk = await this.isGiteaReachable();
    if (!giteaOk) {
      res.status(503).send({ status: 'not_ready', gitea: 'unreachable' });
      return;
    }
    res.status(200).send({ status: 'ok', gitea: 'reachable' });
  }

  private async isGiteaReachable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.settings.gitea_url}/api/healthz`, {
        signal: AbortSignal.timeout(3_000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

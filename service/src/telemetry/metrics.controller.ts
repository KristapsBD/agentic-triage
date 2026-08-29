/**
 * GET /metrics — mirrors HealthController's structure (../health/health.controller.ts):
 * a thin controller over one injected seam. Exposes the TelemetryRecorder's
 * Prometheus registry in text-exposition format. No authentication,
 * consistent with the existing /reports and /health posture.
 */

import { Controller, Get, Inject, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { TELEMETRY_RECORDER, TelemetryRecorder } from './telemetry-recorder.interface';

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(TELEMETRY_RECORDER) private readonly telemetry: TelemetryRecorder) {}

  @Get()
  async get(@Res() res: FastifyReply): Promise<void> {
    const body = await this.telemetry.registry.metrics();
    res.header('Content-Type', this.telemetry.registry.contentType).status(200).send(body);
  }
}

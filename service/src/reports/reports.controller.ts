/**
 * POST /reports. Ticket #28 proved the extraction -> Gitea-write path;
 * ticket #34 adds the full response contract: ReportRequestPipe rejects
 * truly empty/whitespace-only input with 400 before the pipeline runs (the
 * only pre-pipeline rejection), and PipelineExceptionFilter (registered
 * globally in app.module.ts) maps a thrown PipelineUnavailableError to 502
 * — every other input, however short/vague/hostile, flows through the
 * pipeline and settles into one of the 2xx envelope outcomes.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { ReportRequestBody, ReportRequestPipe } from './report-request.pipe';
import { ResponseEnvelope } from './types';

@Controller('reports')
export class ReportsController {
  constructor(private readonly pipeline: PipelineService) {}

  @Post()
  @HttpCode(200)
  async create(@Body(ReportRequestPipe) body: ReportRequestBody): Promise<ResponseEnvelope> {
    return this.pipeline.processReport(body.raw_report);
  }
}

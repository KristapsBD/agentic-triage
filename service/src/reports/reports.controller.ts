/**
 * POST /reports — ticket #28 scope only: a clear bug report in, a Gitea
 * issue out. The full response envelope/error contract (empty-input 400,
 * pipeline-failure 502, one envelope shape for every outcome) is ticket #34;
 * this just proves the extraction -> Gitea-write path end to end.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { ResponseEnvelope } from './types';

interface ReportRequestBody {
  raw_report: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly pipeline: PipelineService) {}

  @Post()
  @HttpCode(200)
  async create(@Body() body: ReportRequestBody): Promise<ResponseEnvelope> {
    return this.pipeline.processReport(body.raw_report);
  }
}

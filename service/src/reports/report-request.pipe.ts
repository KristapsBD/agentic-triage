/**
 * Ticket #34: the one rejection that happens before the pipeline runs.
 * Mirrors app/main.py's post_report empty-check byte-for-byte (error_code
 * "empty_report") — everything else (short, vague, hostile) is the
 * pipeline's job to route, not this pipe's.
 */

import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

export interface ReportRequestBody {
  raw_report: string;
}

const EMPTY_REPORT_ERROR = {
  error_code: 'empty_report',
  message: 'raw_report must not be empty or whitespace-only',
};

@Injectable()
export class ReportRequestPipe implements PipeTransform {
  transform(value: unknown): ReportRequestBody {
    const raw_report = (value as Partial<ReportRequestBody> | undefined)?.raw_report;
    if (typeof raw_report !== 'string' || raw_report.trim().length === 0) {
      throw new BadRequestException(EMPTY_REPORT_ERROR);
    }
    return { raw_report };
  }
}

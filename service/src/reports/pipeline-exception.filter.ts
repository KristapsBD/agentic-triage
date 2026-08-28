/**
 * Ticket #34: maps a thrown PipelineUnavailableError to the 502
 * {error_code, report_hash} contract (app/main.py's post_report try/except,
 * re-expressed as a Nest exception filter so no handler needs its own
 * try/catch). The identical POST is safe to retry — the Decision Record was
 * left in a resumable, non-completed state by the pipeline itself.
 */

import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { PipelineUnavailableError } from './pipeline.errors';

@Catch(PipelineUnavailableError)
export class PipelineExceptionFilter implements ExceptionFilter {
  catch(exception: PipelineUnavailableError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply.status(502).send({
      error_code: exception.errorCode,
      report_hash: exception.reportHash,
    });
  }
}

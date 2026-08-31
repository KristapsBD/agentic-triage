/**
 * Ticket #34: maps a thrown PipelineUnavailableError to the 502
 * {error_code, report_hash} contract (app/main.py's post_report try/except,
 * re-expressed as a Nest exception filter so no handler needs its own
 * try/catch). The identical POST is safe to retry — the Decision Record was
 * left in a resumable, non-completed state by the pipeline itself.
 */

import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { PipelineRejectedError, PipelineUnavailableError } from './pipeline.errors';

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

// F11: a permanent Gitea rejection (4xx) is not retry-safe, so it must not
// share PipelineUnavailableError's 502 contract -- 500 signals "this
// request failed and won't succeed on identical retry" instead.
@Catch(PipelineRejectedError)
export class PipelineRejectedExceptionFilter implements ExceptionFilter {
  catch(exception: PipelineRejectedError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply.status(500).send({
      error_code: exception.errorCode,
      report_hash: exception.reportHash,
    });
  }
}

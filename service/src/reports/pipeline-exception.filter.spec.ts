/** Ticket #34: PipelineUnavailableError -> 502 {error_code, report_hash}, via a global filter, not per-handler try/catch. */

import { ArgumentsHost } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { PipelineExceptionFilter, PipelineRejectedExceptionFilter } from './pipeline-exception.filter';
import { PipelineRejectedError, PipelineUnavailableError } from './pipeline.errors';

function mockReply(): FastifyReply {
  const reply = { status: jest.fn(), send: jest.fn() } as unknown as FastifyReply;
  (reply.status as jest.Mock).mockReturnValue(reply);
  return reply;
}

function mockHost(reply: FastifyReply): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
}

describe('PipelineExceptionFilter', () => {
  it('maps a PipelineUnavailableError to 502 with error_code and report_hash', () => {
    const filter = new PipelineExceptionFilter();
    const reply = mockReply();

    filter.catch(new PipelineUnavailableError('abc123', 'llm_unavailable'), mockHost(reply));

    expect(reply.status).toHaveBeenCalledWith(502);
    expect(reply.send).toHaveBeenCalledWith({ error_code: 'llm_unavailable', report_hash: 'abc123' });
  });
});

// F11: a permanent Gitea rejection must not carry the 502 retry-safe
// contract PipelineExceptionFilter above gives PipelineUnavailableError.
describe('PipelineRejectedExceptionFilter', () => {
  it('maps a PipelineRejectedError to 500 with error_code and report_hash', () => {
    const filter = new PipelineRejectedExceptionFilter();
    const reply = mockReply();

    filter.catch(new PipelineRejectedError('abc123', 'gitea_rejected'), mockHost(reply));

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error_code: 'gitea_rejected', report_hash: 'abc123' });
  });
});

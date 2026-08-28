/** Ticket #34: PipelineUnavailableError -> 502 {error_code, report_hash}, via a global filter, not per-handler try/catch. */

import { ArgumentsHost } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { PipelineExceptionFilter } from './pipeline-exception.filter';
import { PipelineUnavailableError } from './pipeline.errors';

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

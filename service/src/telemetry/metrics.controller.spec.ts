import { FastifyReply } from 'fastify';
import { MetricsController } from './metrics.controller';
import { PrometheusTelemetryRecorder } from './prometheus-telemetry-recorder';

function mockReply(): FastifyReply {
  const reply = {
    status: jest.fn(),
    send: jest.fn(),
    header: jest.fn(),
  } as unknown as FastifyReply;
  (reply.status as jest.Mock).mockReturnValue(reply);
  (reply.header as jest.Mock).mockReturnValue(reply);
  return reply;
}

describe('MetricsController', () => {
  it('serves the Prometheus registry in text-exposition format with no authentication', async () => {
    const telemetry = new PrometheusTelemetryRecorder();
    telemetry.recordOutcome('issue_created');
    const controller = new MetricsController(telemetry);
    const reply = mockReply();

    await controller.get(reply);

    expect(reply.header).toHaveBeenCalledWith('Content-Type', telemetry.registry.contentType);
    expect(reply.status).toHaveBeenCalledWith(200);
    const body = (reply.send as jest.Mock).mock.calls[0][0] as string;
    expect(body).toContain('triage_outcomes_total{outcome="issue_created"} 1');
  });
});

import { ExtractionValidationError, PipelineRejectedError, PipelineUnavailableError, TransientAPIError } from './pipeline.errors';

describe('ExtractionValidationError', () => {
  it('is an Error carrying the given message', () => {
    const error = new ExtractionValidationError('missing severity field');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ExtractionValidationError);
    expect(error.message).toBe('missing severity field');
  });
});

describe('TransientAPIError', () => {
  it('is an Error carrying the given message', () => {
    const error = new TransientAPIError('upstream 503');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TransientAPIError);
    expect(error.message).toBe('upstream 503');
  });
});

describe('PipelineUnavailableError', () => {
  it('carries the report hash and error code passed to it', () => {
    const error = new PipelineUnavailableError('report-abc', 'TRANSIENT_BUDGET_EXHAUSTED', 'exhausted after 3 attempts');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PipelineUnavailableError);
    expect(error.reportHash).toBe('report-abc');
    expect(error.errorCode).toBe('TRANSIENT_BUDGET_EXHAUSTED');
    expect(error.message).toBe('exhausted after 3 attempts');
  });

  it('falls back to the error code as the message when no message is given', () => {
    const error = new PipelineUnavailableError('report-def', 'GITEA_TIMEOUT');
    expect(error.message).toBe('GITEA_TIMEOUT');
  });

  it('falls back to the error code when the message is explicitly empty', () => {
    const error = new PipelineUnavailableError('report-ghi', 'GITEA_TIMEOUT', '');
    expect(error.message).toBe('GITEA_TIMEOUT');
  });

  it('does not confuse a PipelineUnavailableError with a PipelineRejectedError', () => {
    const error = new PipelineUnavailableError('report-jkl', 'GITEA_TIMEOUT');
    expect(error).not.toBeInstanceOf(PipelineRejectedError);
  });
});

describe('PipelineRejectedError', () => {
  it('carries the report hash and error code passed to it', () => {
    const error = new PipelineRejectedError('report-uvw', 'GITEA_REJECTED_4XX', 'repository was deleted');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PipelineRejectedError);
    expect(error.reportHash).toBe('report-uvw');
    expect(error.errorCode).toBe('GITEA_REJECTED_4XX');
    expect(error.message).toBe('repository was deleted');
  });

  it('falls back to the error code as the message when no message is given', () => {
    const error = new PipelineRejectedError('report-xyz', 'GITEA_BAD_TOKEN');
    expect(error.message).toBe('GITEA_BAD_TOKEN');
  });

  it('falls back to the error code when the message is explicitly empty', () => {
    const error = new PipelineRejectedError('report-123', 'GITEA_BAD_TOKEN', '');
    expect(error.message).toBe('GITEA_BAD_TOKEN');
  });

  it('does not confuse a PipelineRejectedError with a PipelineUnavailableError', () => {
    const error = new PipelineRejectedError('report-456', 'GITEA_BAD_TOKEN');
    expect(error).not.toBeInstanceOf(PipelineUnavailableError);
  });
});

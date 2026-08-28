/** Ticket #34: reject truly empty/whitespace-only input at the HTTP boundary, before the pipeline runs. */

import { BadRequestException } from '@nestjs/common';
import { ReportRequestPipe } from './report-request.pipe';

describe('ReportRequestPipe', () => {
  it('rejects whitespace-only raw_report with a 400-shaped error', () => {
    const pipe = new ReportRequestPipe();
    expect(() => pipe.transform({ raw_report: '   \n\t  ' })).toThrow(BadRequestException);
  });

  it('carries error_code "empty_report" and a human message, matching the Python contract byte-for-byte', () => {
    const pipe = new ReportRequestPipe();
    try {
      pipe.transform({ raw_report: '' });
      throw new Error('expected BadRequestException');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toEqual({
        error_code: 'empty_report',
        message: 'raw_report must not be empty or whitespace-only',
      });
    }
  });

  it('rejects a missing raw_report field the same way', () => {
    const pipe = new ReportRequestPipe();
    expect(() => pipe.transform({})).toThrow(BadRequestException);
  });

  it('passes through non-empty raw_report untouched — no trimming of the stored text', () => {
    const pipe = new ReportRequestPipe();
    expect(pipe.transform({ raw_report: '  the api returns 500 sometimes  ' })).toEqual({
      raw_report: '  the api returns 500 sometimes  ',
    });
  });
});

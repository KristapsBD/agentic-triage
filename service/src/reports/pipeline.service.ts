/**
 * The seam other tickets build on — TS equivalent of app/pipeline.py's
 * process_report(). Depends only on TriagePort, never on GiteaClient or any
 * other provider directly, so tests can substitute one FakeTriagePort to
 * cover the whole pipeline (ticket #26's Testing Decisions).
 *
 * Report Type gating, severity/Component branching, Duplicate Verdict
 * routing, Review Flag construction, retry budgets, and Decision Record
 * state transitions are filled in by the tickets that own that behavior
 * (#28-#34).
 */

import { Inject, Injectable } from '@nestjs/common';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';

@Injectable()
export class PipelineService {
  constructor(@Inject(TRIAGE_PORT) private readonly port: TriagePort) {}
}

import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { PrometheusTelemetryRecorder } from './prometheus-telemetry-recorder';
import { TELEMETRY_RECORDER } from './telemetry-recorder.interface';

const telemetryRecorderProvider = {
  provide: TELEMETRY_RECORDER,
  useClass: PrometheusTelemetryRecorder,
};

@Module({
  controllers: [MetricsController],
  providers: [telemetryRecorderProvider],
  exports: [telemetryRecorderProvider],
})
export class TelemetryModule {}

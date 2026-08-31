import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { GiteaModule } from './gitea/gitea.module';
import { HealthModule } from './health/health.module';
import { PipelineExceptionFilter, PipelineRejectedExceptionFilter } from './reports/pipeline-exception.filter';
import { ReportsModule } from './reports/reports.module';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [ConfigModule, GiteaModule, ReportsModule, HealthModule, TelemetryModule],
  providers: [
    { provide: APP_FILTER, useClass: PipelineExceptionFilter },
    { provide: APP_FILTER, useClass: PipelineRejectedExceptionFilter },
  ],
})
export class AppModule {}

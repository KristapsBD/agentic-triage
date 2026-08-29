import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { GiteaModule } from '../gitea/gitea.module';
import { LlmModule } from '../llm/llm.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { PipelineService } from './pipeline.service';
import { ReportsController } from './reports.controller';
import { triagePortProvider } from './triage-port.provider';

@Module({
  imports: [GiteaModule, LlmModule, EmbeddingsModule, DecisionsModule, TelemetryModule],
  controllers: [ReportsController],
  providers: [PipelineService, triagePortProvider],
  exports: [PipelineService],
})
export class ReportsModule {}

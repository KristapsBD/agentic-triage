import { Module } from '@nestjs/common';
import { GiteaModule } from '../gitea/gitea.module';
import { LlmModule } from '../llm/llm.module';
import { PipelineService } from './pipeline.service';
import { ReportsController } from './reports.controller';
import { triagePortProvider } from './triage-port.provider';

@Module({
  imports: [GiteaModule, LlmModule],
  controllers: [ReportsController],
  providers: [PipelineService, triagePortProvider],
  exports: [PipelineService],
})
export class ReportsModule {}

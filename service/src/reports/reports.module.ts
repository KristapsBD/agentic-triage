import { Module } from '@nestjs/common';
import { GiteaModule } from '../gitea/gitea.module';
import { PipelineService } from './pipeline.service';
import { triagePortProvider } from './triage-port.provider';

@Module({
  imports: [GiteaModule],
  providers: [PipelineService, triagePortProvider],
  exports: [PipelineService],
})
export class ReportsModule {}

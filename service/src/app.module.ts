import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { GiteaModule } from './gitea/gitea.module';
import { HealthModule } from './health/health.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [ConfigModule, GiteaModule, ReportsModule, HealthModule],
})
export class AppModule {}

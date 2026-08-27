import { Module } from '@nestjs/common';
import { GiteaClient } from './gitea-client';

@Module({
  providers: [GiteaClient],
  exports: [GiteaClient],
})
export class GiteaModule {}

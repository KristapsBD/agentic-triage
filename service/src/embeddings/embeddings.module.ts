import { Module } from '@nestjs/common';
import { EmbeddingIndex } from './embedding-index';

@Module({
  providers: [EmbeddingIndex],
  exports: [EmbeddingIndex],
})
export class EmbeddingsModule {}

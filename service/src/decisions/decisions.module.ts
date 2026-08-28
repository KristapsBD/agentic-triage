import { Module } from '@nestjs/common';
import { DecisionStore } from './decision-store';

@Module({
  providers: [DecisionStore],
  exports: [DecisionStore],
})
export class DecisionsModule {}

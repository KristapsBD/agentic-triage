import { Module } from '@nestjs/common';
import { DecisionStore } from './decision-store';
import { PrismaService } from './prisma.service';

@Module({
  providers: [DecisionStore, PrismaService],
  exports: [DecisionStore],
})
export class DecisionsModule {}

import { Module } from '@nestjs/common';
import { CheckoutsController } from './checkouts.controller';
import { CheckoutsService } from './checkouts.service';
import { PrismaService } from '../prisma.service';
@Module({ controllers: [CheckoutsController], providers: [CheckoutsService, PrismaService] })
export class CheckoutsModule {}

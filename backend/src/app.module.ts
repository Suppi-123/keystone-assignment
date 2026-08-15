import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { ProductsModule } from './products/products.module';
import { LocationsModule } from './locations/locations.module';
import { InventoryModule } from './inventory/inventory.module';
import { CheckoutsModule } from './checkouts/checkouts.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [ConfigModule.forRoot({ isGlobal: true }), ProductsModule, LocationsModule, InventoryModule, CheckoutsModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}

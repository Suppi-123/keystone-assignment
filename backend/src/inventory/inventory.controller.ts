import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { InventoryService } from './inventory.service';
class AddInventoryDto { @IsString() @IsNotEmpty() productId!: string; @IsString() @IsNotEmpty() locationId!: string; @IsInt() @Min(1) quantity!: number; }
@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}
  @Post() add(@Body() dto: AddInventoryDto) { return this.service.addStock(dto.productId, dto.locationId, dto.quantity); }
  @Get(':productId') byProduct(@Param('productId') productId: string) { return this.service.byProduct(productId); }
}

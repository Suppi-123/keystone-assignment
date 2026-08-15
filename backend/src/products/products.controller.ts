import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ProductsService } from './products.service';
class CreateProductDto { @IsString() @IsNotEmpty() name!: string; }
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}
  @Post() create(@Body() dto: CreateProductDto) { return this.service.create(dto.name); }
  @Get() findAll() { return this.service.findAll(); }
}

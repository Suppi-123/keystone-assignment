import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { LocationsService } from './locations.service';
class CreateLocationDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() city!: string;
  @IsString() @IsNotEmpty() state!: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) pincodes?: string[];
}
@Controller('locations')
export class LocationsController {
  constructor(private readonly service: LocationsService) {}
  @Post() create(@Body() dto: CreateLocationDto) { return this.service.create(dto); }
  @Get() findAll() { return this.service.findAll(); }
}

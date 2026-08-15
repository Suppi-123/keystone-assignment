import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
} from 'class-validator';

import { CheckoutsService } from './checkouts.service';

class StartCheckoutDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  deliveryPincode!: string;

  @IsOptional()
  @IsString()
  deliveryCity?: string;

  @IsOptional()
  @IsString()
  deliveryState?: string;
}

@Controller('checkouts')
export class CheckoutsController {
  constructor(
    private readonly service: CheckoutsService,
  ) {}

  // =========================
  // START CHECKOUT
  // =========================
  @Post()
  start(
    @Body() dto: StartCheckoutDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.start({
      ...dto,
      idempotencyKey: key ?? '',
    });
  }

  // =========================
  // AUTOMATIC EXPIRATION
  // Put this BEFORE :id routes
  // =========================
  @Post('expire')
  expireAbandoned() {
    return this.service.expireAbandoned();
  }

  // =========================
  // PAYMENT SUCCESS
  // =========================
  @Post(':id/success')
  success(@Param('id') id: string) {
    return this.service.success(id);
  }

  // =========================
  // PAYMENT FAILED
  // =========================
  @Post(':id/fail')
  fail(@Param('id') id: string) {
    return this.service.fail(id);
  }

  // =========================
  // ABANDON CHECKOUT
  // =========================
  @Post(':id/abandon')
  abandon(@Param('id') id: string) {
    return this.service.abandon(id);
  }

  // =========================
  // MANUAL EXPIRE
  // Used by "Expire Abandoned" button
  // =========================
  @Post(':id/expire')
  expire(@Param('id') id: string) {
    return this.service.expire(id);
  }

  // =========================
  // GET CHECKOUT
  // =========================
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  // =========================
  // AVAILABILITY
  // =========================
  @Get('availability/:productId')
  availability(
    @Param('productId') productId: string,
  ) {
    return this.service.availability(productId);
  }
}
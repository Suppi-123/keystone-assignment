import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}
  create(name: string) { return this.prisma.product.create({ data: { name } }); }
  findAll() { return this.prisma.product.findMany({ orderBy: { createdAt: 'desc' } }); }
}

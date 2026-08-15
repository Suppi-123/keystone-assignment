import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}
  async addStock(productId: string, locationId: string, quantity: number) {
    if (quantity <= 0) throw new BadRequestException('quantity must be greater than 0');
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!product || !location) throw new NotFoundException('Product or location not found');
    return this.prisma.inventory.upsert({
      where: { productId_locationId: { productId, locationId } },
      create: { productId, locationId, stock: quantity, reserved: 0 },
      update: { stock: { increment: quantity } },
      include: { product: true, location: true },
    });
  }
  async byProduct(productId: string) {
    return this.prisma.inventory.findMany({
      where: { productId }, include: { location: true },
      orderBy: [{ location: { priority: 'asc' } }],
    });
  }
  async availability(productId: string) {
    const rows = await this.prisma.inventory.findMany({ where: { productId, location: { active: true } } });
    return { productId, available: rows.reduce((sum, r) => sum + Math.max(0, r.stock - r.reserved), 0) };
  }
}

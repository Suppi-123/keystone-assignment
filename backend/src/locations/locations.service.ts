import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}
  create(data: { name: string; city: string; state: string; active?: boolean; priority?: number; pincodes?: string[] }) {
    return this.prisma.location.create({
      data: {
        name: data.name, city: data.city, state: data.state,
        active: data.active ?? true, priority: data.priority ?? 100,
        serviceZones: { create: (data.pincodes ?? []).map(pincode => ({ pincode })) },
      }, include: { serviceZones: true },
    });
  }
  findAll() { return this.prisma.location.findMany({ include: { serviceZones: true }, orderBy: [{ active: 'desc' }, { priority: 'asc' }] }); }
}

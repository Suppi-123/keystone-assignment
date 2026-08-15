import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { CheckoutsService } from '../src/checkouts/checkouts.service';
import { CheckoutStatus } from '@prisma/client';

/**
 * Integration suite. Run against a disposable PostgreSQL database:
 * DATABASE_URL=postgresql://... npm run prisma:push && npm test
 */
describe('Checkout reservation integration', () => {
  let prisma: PrismaService;
  let service: CheckoutsService;
  let productId: string;
  let locationId: string;
  let fallbackId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ providers: [PrismaService, CheckoutsService] }).compile();
    prisma = module.get(PrismaService);
    service = module.get(CheckoutsService);
    await prisma.$connect();
    await prisma.checkout.deleteMany();
    await prisma.inventory.deleteMany();
    await prisma.serviceZone.deleteMany();
    await prisma.product.deleteMany();
    await prisma.location.deleteMany();
    const product = await prisma.product.create({ data: { name: 'Test Product' } });
    productId = product.id;
    const location = await prisma.location.create({ data: { name: 'Zone A', city: 'Bangalore', state: 'Karnataka', priority: 2, serviceZones: { create: { pincode: '560001' } } } });
    const fallback = await prisma.location.create({ data: { name: 'Zone B', city: 'Mysore', state: 'Karnataka', priority: 1 } });
    locationId = location.id; fallbackId = fallback.id;
    await prisma.inventory.create({ data: { productId, locationId, stock: 10 } });
    await prisma.inventory.create({ data: { productId, locationId: fallbackId, stock: 20 } });
  });

  afterAll(async () => { await prisma.$disconnect(); });

  test('reserves stock and reduces availability', async () => {
    const c = await service.start({ productId, quantity: 3, deliveryPincode: '560001', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 't1' });
    expect(c.status).toBe(CheckoutStatus.RESERVED);
    const inv = await prisma.inventory.findUnique({ where: { productId_locationId: { productId, locationId } } });
    expect(inv?.reserved).toBe(3);
    expect((inv?.stock ?? 0) - (inv?.reserved ?? 0)).toBe(7);
  });

  test('payment success deducts stock and clears reservation', async () => {
    const c = await service.start({ productId, quantity: 2, deliveryPincode: '560001', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 't2' });
    await service.success(c.id);
    const inv = await prisma.inventory.findUnique({ where: { productId_locationId: { productId, locationId } } });
    expect(inv?.stock).toBe(5);
    expect(inv?.reserved).toBe(3);
  });

  test('payment failure releases reservation', async () => {
    const c = await service.start({ productId, quantity: 2, deliveryPincode: '560001', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 't3' });
    await service.fail(c.id);
    const inv = await prisma.inventory.findUnique({ where: { productId_locationId: { productId, locationId } } });
    expect(inv?.reserved).toBe(3);
  });

  test('abandoned checkout keeps reservation and expiry releases it', async () => {
    const c = await service.start({ productId, quantity: 1, deliveryPincode: '560001', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 't4' });
    await service.abandon(c.id);
    const before = await prisma.inventory.findUnique({ where: { productId_locationId: { productId, locationId } } });
    expect(before?.reserved).toBe(4);
    await prisma.checkout.update({ where: { id: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await service.expireAbandoned();
    const after = await prisma.inventory.findUnique({ where: { productId_locationId: { productId, locationId } } });
    expect(after?.reserved).toBe(3);
    expect((await prisma.checkout.findUnique({ where: { id: c.id } }))?.status).toBe(CheckoutStatus.EXPIRED);
  });

  test('service-zone location is preferred', async () => {
    const c = await service.start({ productId, quantity: 1, deliveryPincode: '560001', deliveryCity: 'Mysore', deliveryState: 'Karnataka', idempotencyKey: 't5' });
    expect(c.locationId).toBe(locationId);
    await service.fail(c.id);
  });

  test('fallback works when no service-zone location can fulfill', async () => {
    const c = await service.start({ productId, quantity: 6, deliveryPincode: '999999', deliveryCity: 'Mysore', deliveryState: 'Karnataka', idempotencyKey: 't6' });
    expect(c.locationId).toBe(fallbackId);
    await service.fail(c.id);
  });

  test('same idempotency key returns existing checkout', async () => {
    const input = { productId, quantity: 1, deliveryPincode: '560001', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 'same-key' };
    const a = await service.start(input); const b = await service.start(input);
    expect(b.id).toBe(a.id);
    await service.fail(a.id);
  });

  test('same idempotency key with changed payload is rejected', async () => {
    const input = { productId, quantity: 1, deliveryPincode: '560001', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 'changed-key' };
    const a = await service.start(input);
    await expect(service.start({ ...input, quantity: 2 })).rejects.toBeInstanceOf(ConflictException);
    await service.fail(a.id);
  });

  test('concurrent checkouts cannot reserve more than stock', async () => {
    const p = await prisma.product.create({ data: { name: 'Concurrency Product' } });
    const loc = await prisma.location.create({ data: { name: 'Concurrency Warehouse', city: 'Bangalore', state: 'Karnataka', priority: 1 } });
    await prisma.inventory.create({ data: { productId: p.id, locationId: loc.id, stock: 2, reserved: 0 } });
    // Two requests each ask for 2. The row lock allows only one to win.
    const results = await Promise.allSettled([
      service.start({ productId: p.id, quantity: 2, deliveryPincode: '999999', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 'con-1' }),
      service.start({ productId: p.id, quantity: 2, deliveryPincode: '999999', deliveryCity: 'Bangalore', deliveryState: 'Karnataka', idempotencyKey: 'con-2' }),
    ]);
    const inv = await prisma.inventory.findUnique({ where: { productId_locationId: { productId: p.id, locationId: loc.id } } });
    expect(inv?.reserved).toBeLessThanOrEqual(inv?.stock ?? 0);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
});

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.checkout.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.serviceZone.deleteMany();
  await prisma.product.deleteMany();
  await prisma.location.deleteMany();

  const product = await prisma.product.create({ data: { name: 'iPhone 17' } });
  const blr = await prisma.location.create({ data: {
    name: 'Bangalore Warehouse', city: 'Bangalore', state: 'Karnataka', priority: 1,
    serviceZones: { create: [{ pincode: '560001' }, { pincode: '560002' }] },
  }});
  const mys = await prisma.location.create({ data: {
    name: 'Mysore Warehouse', city: 'Mysore', state: 'Karnataka', priority: 2,
    serviceZones: { create: [{ pincode: '570001' }] },
  }});
  await prisma.inventory.createMany({ data: [
    { productId: product.id, locationId: blr.id, stock: 10, reserved: 0 },
    { productId: product.id, locationId: mys.id, stock: 5, reserved: 0 },
  ]});
  console.log({ product, blr, mys });
}
main().finally(() => prisma.$disconnect());

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  CheckoutStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma.service';

interface StartCheckoutInput {
  productId: string;
  quantity: number;
  deliveryPincode: string;
  deliveryCity?: string;
  deliveryState?: string;
  idempotencyKey: string;
}

type Tx = Prisma.TransactionClient;

type Candidate = {
  id: string;
  name: string;
  city: string;
  state: string;
  priority: number;
  tier: number;
};

@Injectable()
export class CheckoutsService {
  private readonly retryWindowMinutes = Number(
    process.env.RETRY_WINDOW_MINUTES ?? 15,
  );

  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // CHECK IDEMPOTENCY PAYLOAD
  // ============================================================

  private payloadMatches(
    existing: any,
    input: StartCheckoutInput,
  ) {
    return (
      existing.productId === input.productId &&
      existing.quantity === input.quantity &&
      existing.deliveryPincode ===
        input.deliveryPincode &&
      (existing.deliveryCity ?? '') ===
        (input.deliveryCity ?? '') &&
      (existing.deliveryState ?? '') ===
        (input.deliveryState ?? '')
    );
  }

  // ============================================================
  // FIND BEST LOCATION
  // ============================================================

  private async candidates(
    tx: Tx,
    input: StartCheckoutInput,
  ): Promise<Candidate[]> {
    const locations =
      await tx.location.findMany({
        where: {
          active: true,
        },

        include: {
          serviceZones: true,

          inventory: {
            where: {
              productId: input.productId,
            },
          },
        },
      });

    return locations
      .map((location) => {
        const inventory =
          location.inventory[0];

        const canFulfill =
          !!inventory &&
          inventory.stock -
            inventory.reserved >=
            input.quantity;

        const servesPincode =
          location.serviceZones.some(
            (zone) =>
              zone.pincode ===
              input.deliveryPincode,
          );

        let tier = 999;

        if (
          servesPincode &&
          canFulfill
        ) {
          tier = 1;
        } else if (
          input.deliveryCity &&
          location.city.toLowerCase() ===
            input.deliveryCity.toLowerCase() &&
          canFulfill
        ) {
          tier = 2;
        } else if (
          input.deliveryState &&
          location.state.toLowerCase() ===
            input.deliveryState.toLowerCase() &&
          canFulfill
        ) {
          tier = 3;
        } else if (canFulfill) {
          tier = 4;
        }

        return {
          id: location.id,
          name: location.name,
          city: location.city,
          state: location.state,
          priority: location.priority,
          tier,
        };
      })
      .filter(
        (location) =>
          location.tier < 999,
      )
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          a.priority - b.priority ||
          a.name.localeCompare(b.name),
      );
  }

  // ============================================================
  // START CHECKOUT
  // ============================================================

  async start(
    input: StartCheckoutInput,
  ) {
    if (input.quantity <= 0) {
      throw new BadRequestException(
        'quantity must be greater than 0',
      );
    }

    if (
      !input.idempotencyKey?.trim()
    ) {
      throw new BadRequestException(
        'Idempotency-Key is required',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // ------------------------------------------------------
        // IDEMPOTENCY
        // ------------------------------------------------------

        const existing =
          await tx.checkout.findUnique({
            where: {
              idempotencyKey:
                input.idempotencyKey,
            },
          });

        if (existing) {
          if (
            !this.payloadMatches(
              existing,
              input,
            )
          ) {
            throw new ConflictException(
              'Idempotency key already used with a different payload',
            );
          }

          return existing;
        }

        // ------------------------------------------------------
        // PRODUCT
        // ------------------------------------------------------

        const product =
          await tx.product.findUnique({
            where: {
              id: input.productId,
            },
          });

        if (!product) {
          throw new NotFoundException(
            'Product not found',
          );
        }

        // ------------------------------------------------------
        // LOCATION
        // ------------------------------------------------------

        const candidates =
          await this.candidates(
            tx,
            input,
          );

        if (!candidates.length) {
          throw new ConflictException(
            'No active location can fulfill the requested quantity',
          );
        }

        // ------------------------------------------------------
        // RESERVE STOCK
        // ------------------------------------------------------

        for (const candidate of candidates) {
          const inventoryId =
            await this.inventoryId(
              tx,
              input.productId,
              candidate.id,
            );

          if (!inventoryId) {
            continue;
          }

          // Lock inventory row
          const locked =
            await tx.$queryRaw<
              Array<{
                id: string;
                stock: number;
                reserved: number;
              }>
            >`
              SELECT id, stock, reserved
              FROM "Inventory"
              WHERE id = ${inventoryId}
              FOR UPDATE
            `;

          if (!locked.length) {
            continue;
          }

          const row = locked[0];

          // Check stock again after locking
          if (
            row.stock -
              row.reserved <
            input.quantity
          ) {
            continue;
          }

          // Reserve stock
          await tx.inventory.update({
            where: {
              id: row.id,
            },

            data: {
              reserved: {
                increment:
                  input.quantity,
              },
            },
          });

          const expiresAt =
            new Date(
              Date.now() +
                this.retryWindowMinutes *
                  60_000,
            );

          // Create checkout
          return tx.checkout.create({
            data: {
              productId:
                input.productId,

              locationId:
                candidate.id,

              quantity:
                input.quantity,

              deliveryPincode:
                input.deliveryPincode,

              deliveryCity:
                input.deliveryCity,

              deliveryState:
                input.deliveryState,

              status:
                CheckoutStatus.RESERVED,

              idempotencyKey:
                input.idempotencyKey,

              expiresAt,
            },

            include: {
              product: true,
              location: true,
            },
          });
        }

        throw new ConflictException(
          'Stock changed while reserving; no location can fulfill the request now',
        );
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel
            .ReadCommitted,
      },
    );
  }

  // ============================================================
  // GET INVENTORY ID
  // ============================================================

  private async inventoryId(
    tx: Tx,
    productId: string,
    locationId: string,
  ) {
    const row =
      await tx.inventory.findUnique({
        where: {
          productId_locationId: {
            productId,
            locationId,
          },
        },

        select: {
          id: true,
        },
      });

    return row?.id ?? '';
  }

  // ============================================================
  // STATUS TRANSITION
  //
  // RESERVED -> PAID
  // RESERVED -> FAILED
  // RESERVED -> ABANDONED
  // ============================================================

  private async transition(
    checkoutId: string,
    expected: CheckoutStatus,
    next: CheckoutStatus,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const checkout =
          await tx.checkout.findUnique({
            where: {
              id: checkoutId,
            },
          });

        if (!checkout) {
          throw new NotFoundException(
            'Checkout not found',
          );
        }

        // Already transitioned
        if (
          checkout.status !== expected
        ) {
          return checkout;
        }

        const inventory =
          await tx.inventory.findUnique({
            where: {
              productId_locationId: {
                productId:
                  checkout.productId,

                locationId:
                  checkout.locationId,
              },
            },
          });

        if (!inventory) {
          throw new NotFoundException(
            'Inventory record not found',
          );
        }

        // Lock inventory row
        const locked =
          await tx.$queryRaw<
            Array<{
              id: string;
              stock: number;
              reserved: number;
            }>
          >`
            SELECT id, stock, reserved
            FROM "Inventory"
            WHERE id = ${inventory.id}
            FOR UPDATE
          `;

        if (!locked.length) {
          throw new NotFoundException(
            'Inventory record not found',
          );
        }

        // ======================================================
        // PAYMENT SUCCESS
        //
        // RESERVED -> PAID
        //
        // Stock decreases.
        // Reserved decreases.
        // ======================================================

        if (
          next === CheckoutStatus.PAID
        ) {
          if (
            locked[0].reserved <
            checkout.quantity
          ) {
            throw new ConflictException(
              'Inventory reservation is inconsistent',
            );
          }

          await tx.inventory.update({
            where: {
              id: inventory.id,
            },

            data: {
              stock: {
                decrement:
                  checkout.quantity,
              },

              reserved: {
                decrement:
                  checkout.quantity,
              },
            },
          });
        }

        // ======================================================
        // PAYMENT FAILED
        //
        // RESERVED -> FAILED
        //
        // Reservation is released immediately.
        // ======================================================

        else if (
          next ===
          CheckoutStatus.FAILED
        ) {
          if (
            locked[0].reserved <
            checkout.quantity
          ) {
            throw new ConflictException(
              'Inventory reservation is inconsistent',
            );
          }

          await tx.inventory.update({
            where: {
              id: inventory.id,
            },

            data: {
              reserved: {
                decrement:
                  checkout.quantity,
              },
            },
          });
        }

        // ======================================================
        // ABANDON
        //
        // RESERVED -> ABANDONED
        //
        // IMPORTANT:
        // DO NOT RELEASE RESERVED STOCK.
        //
        // It remains reserved until expiration.
        // ======================================================

        else if (
          next ===
          CheckoutStatus.ABANDONED
        ) {
          // Nothing changes in inventory.
          //
          // reserved stock remains reserved.
        }

        // Update checkout status
        return tx.checkout.update({
          where: {
            id: checkout.id,
          },

          data: {
            status: next,
          },

          include: {
            product: true,
            location: true,
          },
        });
      },
    );
  }

  // ============================================================
  // PAYMENT SUCCESS
  // ============================================================

  success(id: string) {
    return this.transition(
      id,
      CheckoutStatus.RESERVED,
      CheckoutStatus.PAID,
    );
  }

  // ============================================================
  // PAYMENT FAILED
  // ============================================================

  fail(id: string) {
    return this.transition(
      id,
      CheckoutStatus.RESERVED,
      CheckoutStatus.FAILED,
    );
  }

  // ============================================================
  // ABANDON
  // ============================================================

  abandon(id: string) {
    return this.transition(
      id,
      CheckoutStatus.RESERVED,
      CheckoutStatus.ABANDONED,
    );
  }

  // ============================================================
  // MANUAL EXPIRE
  //
  // ABANDONED -> EXPIRED
  //
  // This is called by:
  // POST /checkouts/:id/expire
  // ============================================================

  async expire(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const checkout =
          await tx.checkout.findUnique({
            where: {
              id,
            },
          });

        if (!checkout) {
          throw new NotFoundException(
            'Checkout not found',
          );
        }

        // Only ABANDONED can be expired
        if (
          checkout.status !==
          CheckoutStatus.ABANDONED
        ) {
          return checkout;
        }

        const inventory =
          await tx.inventory.findUnique({
            where: {
              productId_locationId: {
                productId:
                  checkout.productId,

                locationId:
                  checkout.locationId,
              },
            },
          });

        if (!inventory) {
          throw new NotFoundException(
            'Inventory record not found',
          );
        }

        // Lock inventory
        const locked =
          await tx.$queryRaw<
            Array<{
              id: string;
              stock: number;
              reserved: number;
            }>
          >`
            SELECT id, stock, reserved
            FROM "Inventory"
            WHERE id = ${inventory.id}
            FOR UPDATE
          `;

        if (!locked.length) {
          throw new NotFoundException(
            'Inventory record not found',
          );
        }

        // Check reservation
        if (
          locked[0].reserved <
          checkout.quantity
        ) {
          throw new ConflictException(
            'Inventory reservation is inconsistent',
          );
        }

        // Release reserved stock
        await tx.inventory.update({
          where: {
            id: inventory.id,
          },

          data: {
            reserved: {
              decrement:
                checkout.quantity,
            },
          },
        });

        // ABANDONED -> EXPIRED
        return tx.checkout.update({
          where: {
            id: checkout.id,
          },

          data: {
            status:
              CheckoutStatus.EXPIRED,
          },

          include: {
            product: true,
            location: true,
          },
        });
      },
    );
  }

  // ============================================================
  // AUTOMATIC EXPIRATION
  //
  // Only expires abandoned checkouts whose
  // expiresAt has passed.
  // ============================================================

  async expireAbandoned() {
    const now = new Date();

    const abandoned =
      await this.prisma.checkout.findMany({
        where: {
          status:
            CheckoutStatus.ABANDONED,

          expiresAt: {
            lte: now,
          },
        },

        select: {
          id: true,
        },
      });

    const expired: string[] = [];

    for (const item of abandoned) {
      await this.prisma.$transaction(
        async (tx) => {
          const checkout =
            await tx.checkout.findUnique({
              where: {
                id: item.id,
              },
            });

          if (
            !checkout ||
            checkout.status !==
              CheckoutStatus.ABANDONED ||
            !checkout.expiresAt ||
            checkout.expiresAt >
              new Date()
          ) {
            return;
          }

          const inventory =
            await tx.inventory.findUnique({
              where: {
                productId_locationId: {
                  productId:
                    checkout.productId,

                  locationId:
                    checkout.locationId,
                },
              },
            });

          if (!inventory) {
            throw new NotFoundException(
              'Inventory record not found',
            );
          }

          const locked =
            await tx.$queryRaw<
              Array<{
                id: string;
                stock: number;
                reserved: number;
              }>
            >`
              SELECT id, stock, reserved
              FROM "Inventory"
              WHERE id = ${inventory.id}
              FOR UPDATE
            `;

          if (!locked.length) {
            return;
          }

          // Prevent negative reservation
          if (
            locked[0].reserved <
            checkout.quantity
          ) {
            return;
          }

          // Release reservation
          await tx.inventory.update({
            where: {
              id: inventory.id,
            },

            data: {
              reserved: {
                decrement:
                  checkout.quantity,
              },
            },
          });

          // Mark expired
          await tx.checkout.update({
            where: {
              id: checkout.id,
            },

            data: {
              status:
                CheckoutStatus.EXPIRED,
            },
          });

          expired.push(checkout.id);
        },
      );
    }

    return {
      expiredCount: expired.length,
      checkoutIds: expired,
    };
  }

  // ============================================================
  // GET CHECKOUT
  // ============================================================

  get(id: string) {
    return this.prisma.checkout.findUnique({
      where: {
        id,
      },

      include: {
        product: true,
        location: true,
      },
    });
  }

  // ============================================================
  // AVAILABILITY
  // ============================================================

  availability(productId: string) {
    return this.prisma.inventory.findMany({
      where: {
        productId,

        location: {
          active: true,
        },
      },

      include: {
        location: true,
      },

      orderBy: [
        {
          location: {
            priority: 'asc',
          },
        },
      ],
    });
  }
}
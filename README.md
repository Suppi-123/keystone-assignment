# Keystone Commerce — Location-Based Inventory Reservation

A full-stack implementation of the supplied Keystone Commerce assignment.
## Live Application

**Frontend:** https://keystone-assignment-1.onrender.com

**Hosted API:** https://keystone-assignment.onrender.com

**Health Check:** https://keystone-assignment.onrender.com/health
## What it does

- Create products and warehouse locations.
- Add inventory per product/location.
- Select one location for a checkout using the required service-zone and fallback rules.
- Reserve inventory safely under concurrency.
- Support payment success, failure, and abandoned states.
- Expire abandoned reservations after a retry window.
- Enforce idempotency keys.
- Query product availability and location-level inventory.
- Provide a small React + TypeScript frontend.
- Includes Docker configuration and an integration test suite.

## Stack

- Backend: NestJS + TypeScript
- Persistence: PostgreSQL + Prisma
- Tests: Jest
- Frontend: React + TypeScript + Vite
- Docker: PostgreSQL + API + frontend

## Why PostgreSQL

The assignment's difficult requirement is concurrency. PostgreSQL transactions and `SELECT ... FOR UPDATE` row locks let the checkout service serialize changes to one inventory record. This prevents two simultaneous checkout requests from both seeing the same stock and over-reserving it.

## Inventory invariant

`available = stock - reserved`

- Reservation: `reserved += quantity`
- Payment success: `stock -= quantity`, `reserved -= quantity`
- Payment failure: `reserved -= quantity`
- Abandoned checkout: reservation remains until expiry
- Expiry: `reserved -= quantity`

## Location selection

1. Active service-zone location that serves the delivery pincode and can fulfill the entire quantity.
2. If several qualify, lowest priority number wins.
3. If none qualifies, fallback to same city, then same state, then any active location.
4. A checkout never splits quantity between locations.

The service first finds candidates, then locks the selected inventory row inside the transaction and re-checks availability immediately before incrementing `reserved`. If a concurrent request consumed the stock first, it tries the next candidate.

## Idempotency

The client sends an `Idempotency-Key` header to `POST /checkouts`.

- Same key + same payload: returns the existing checkout.
- Same key + different payload: HTTP 409.
- The database has a unique constraint on the key.

## API

### Create product
`POST /products`

```json
{"name":"iPhone 17"}
```

### Create location
`POST /locations`

```json
{
  "name":"Bangalore Warehouse",
  "city":"Bangalore",
  "state":"Karnataka",
  "priority":1,
  "pincodes":["560001","560002"]
}
```

### Add inventory
`POST /inventory`

```json
{"productId":"PRODUCT_ID","locationId":"LOCATION_ID","quantity":10}
```

### Start checkout
`POST /checkouts`

Header:
`Idempotency-Key: unique-request-key`

Body:

```json
{
  "productId":"PRODUCT_ID",
  "quantity":3,
  "deliveryPincode":"560001",
  "deliveryCity":"Bangalore",
  "deliveryState":"Karnataka"
}
```

### Payment transitions

- `POST /checkouts/:id/success`
- `POST /checkouts/:id/fail`
- `POST /checkouts/:id/abandon`
- `POST /checkouts/expire`

### Queries

- `GET /checkouts/:id`
- `GET /checkouts/availability/:productId`
- `GET /inventory/:productId`
- `GET /products`
- `GET /locations`
- `GET /health`

## Run locally

### Requirements

- Node.js 22+
- Docker Desktop (recommended)

### 1. Start PostgreSQL

From the repository root:

```bash
docker compose up -d postgres
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma db push
npm run start:dev
```

Optional sample data:

```bash
npx prisma db seed
```

API: `http://localhost:3000`

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend: `http://localhost:5173`

## Run everything with Docker

```bash
docker compose -f docker-compose.full.yml up --build
```

- API: `http://localhost:3000`
- Web: `http://localhost:8080`

## Tests

Use a disposable PostgreSQL database and set `DATABASE_URL` to it.

```bash
cd backend
npx prisma db push
npm test
```

The integration suite covers:

1. reservation reduces available stock
2. payment success
3. payment failure
4. abandoned checkout
5. expiry
6. service-zone selection
7. fallback selection
8. idempotent retry
9. changed payload with same key
10. concurrent reservation safety



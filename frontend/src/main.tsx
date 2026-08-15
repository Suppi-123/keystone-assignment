import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Product = {
  id: string;
  name: string;
};

type Location = {
  id: string;
  name: string;
  city: string;
  state: string;
  priority: number;
  active: boolean;
};

type Checkout = {
  id: string;
  quantity: number;
  status: string;
  location?: Location;
  product?: Product;
  expiresAt?: string;
};

type Inventory = {
  id?: string;
  stock: number;
  reserved: number;
  location: Location;
};

async function api(
  path: string,
  options: RequestInit = {},
) {
  const url = `${API}${path}`;

  const headers = new Headers(options.headers);

  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const text = await response.text();

  let data: any = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }

  if (!response.ok) {
    let message = 'Request failed';

    if (Array.isArray(data?.message)) {
      message = data.message.join(', ');
    } else if (data?.message) {
      message = data.message;
    } else if (typeof data === 'string') {
      message = data;
    }

    throw new Error(message);
  }

  return data;
}

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);

  const [pincode, setPincode] = useState('560001');
  const [city, setCity] = useState('Bangalore');
  const [state, setState] = useState('Karnataka');

  const [checkout, setCheckout] =
    useState<Checkout | null>(null);

  const [inventory, setInventory] =
    useState<Inventory[]>([]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] =
    useState(false);

  // =========================================================
  // LOAD PRODUCTS
  // =========================================================

  const loadProducts = async () => {
    setLoadingProducts(true);

    try {
      const data = await api('/products');

      console.log('Products API response:', data);

      const productList: Product[] = Array.isArray(data)
        ? data
        : data?.products ?? data?.data ?? [];

      setProducts(productList);

      // Automatically select first product
      if (productList.length > 0) {
        setProductId((current) =>
          current &&
          productList.some(
            (product) => product.id === current,
          )
            ? current
            : productList[0].id,
        );
      } else {
        setProductId('');
        setError('No products found');
      }
    } catch (e) {
      console.error('Products error:', e);

      setProducts([]);
      setProductId('');

      setError(
        e instanceof Error
          ? `Products: ${e.message}`
          : 'Failed to load products',
      );
    } finally {
      setLoadingProducts(false);
    }
  };

  // =========================================================
  // LOAD LOCATIONS
  // =========================================================

  const loadLocations = async () => {
    try {
      const data = await api('/locations');

      console.log('Locations API response:', data);

      const locationList: Location[] =
        Array.isArray(data)
          ? data
          : data?.locations ?? data?.data ?? [];

      setLocations(locationList);
    } catch (e) {
      console.error('Locations error:', e);

      setLocations([]);

      setError(
        e instanceof Error
          ? `Locations: ${e.message}`
          : 'Failed to load locations',
      );
    }
  };

  // =========================================================
  // LOAD INVENTORY
  // =========================================================

  const loadInventory = async (id: string) => {
    if (!id) {
      setInventory([]);
      return;
    }

    try {
      const data = await api(`/inventory/${id}`);

      console.log(
        'Inventory API response:',
        data,
      );

      const inventoryList: Inventory[] =
        Array.isArray(data)
          ? data
          : data?.inventory ?? data?.data ?? [];

      setInventory(inventoryList);
    } catch (e) {
      console.error('Inventory error:', e);

      setInventory([]);

      setError(
        e instanceof Error
          ? `Inventory: ${e.message}`
          : 'Failed to load inventory',
      );
    }
  };

  // =========================================================
  // INITIAL LOAD
  // =========================================================

  useEffect(() => {
    const loadInitialData = async () => {
      await Promise.all([
        loadProducts(),
        loadLocations(),
      ]);
    };

    loadInitialData();
  }, []);

  // =========================================================
  // WHEN PRODUCT CHANGES
  // =========================================================

  useEffect(() => {
    if (!productId) {
      setInventory([]);
      return;
    }

    loadInventory(productId);
  }, [productId]);

  // =========================================================
  // AVAILABLE TOTAL
  // =========================================================

  const availableTotal = useMemo(() => {
    return inventory.reduce(
      (total, item) =>
        total +
        Math.max(
          0,
          item.stock - item.reserved,
        ),
      0,
    );
  }, [inventory]);

  // =========================================================
  // PRODUCT CHANGE
  // =========================================================

  const handleProductChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const selectedId = event.target.value;

    console.log(
      'Selected product:',
      selectedId,
    );

    setProductId(selectedId);

    // Remove previous checkout
    setCheckout(null);

    // Clear old error
    setError('');

    // Reset quantity
    setQuantity(1);
  };

  // =========================================================
  // START CHECKOUT
  // =========================================================

  const startCheckout = async () => {
    setError('');
    setCheckout(null);

    if (!productId) {
      setError('Please select a product');
      return;
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      setError(
        'Quantity must be a whole number greater than 0',
      );
      return;
    }

    if (!pincode.trim()) {
      setError(
        'Please enter delivery pincode',
      );
      return;
    }

    if (!city.trim()) {
      setError(
        'Please enter delivery city',
      );
      return;
    }

    if (!state.trim()) {
      setError(
        'Please enter delivery state',
      );
      return;
    }

    setLoading(true);

    try {
      const idempotencyKey =
        crypto.randomUUID();

      const payload = {
        productId,
        quantity: Number(quantity),
        deliveryPincode: pincode.trim(),
        deliveryCity: city.trim(),
        deliveryState: state.trim(),
      };

      console.log(
        'Starting checkout:',
        payload,
      );

      const checkoutData =
        await api('/checkouts', {
          method: 'POST',

          headers: {
            'Idempotency-Key':
              idempotencyKey,
          },

          body: JSON.stringify(payload),
        });

      console.log(
        'Checkout response:',
        checkoutData,
      );

      setCheckout(checkoutData);

      await loadInventory(productId);
    } catch (e) {
      console.error(
        'Checkout error:',
        e,
      );

      setCheckout(null);

      setError(
        e instanceof Error
          ? e.message
          : 'Checkout failed',
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // PAYMENT SUCCESS / FAILED / ABANDON
  // =========================================================

  const transition = async (
    action:
      | 'success'
      | 'fail'
      | 'abandon',
  ) => {
    if (!checkout) {
      return;
    }

    if (checkout.status !== 'RESERVED') {
      setError(
        `This action is not available for checkout with status ${checkout.status}`,
      );
      return;
    }

    setError('');
    setLoading(true);

    try {
      const checkoutData =
        await api(
          `/checkouts/${checkout.id}/${action}`,
          {
            method: 'POST',
          },
        );

      console.log(
        `${action} response:`,
        checkoutData,
      );

      setCheckout(checkoutData);

      await loadInventory(productId);
    } catch (e) {
      console.error(
        `${action} error:`,
        e,
      );

      setError(
        e instanceof Error
          ? e.message
          : 'Action failed',
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // EXPIRE ABANDONED
  // =========================================================

  const expire = async () => {
    if (
      !checkout ||
      checkout.status !== 'ABANDONED'
    ) {
      return;
    }

    setError('');
    setLoading(true);

    try {
      const checkoutData =
        await api(
          `/checkouts/${checkout.id}/expire`,
          {
            method: 'POST',
          },
        );

      console.log(
        'Expire response:',
        checkoutData,
      );

      // IMPORTANT:
      // Update checkout status from ABANDONED
      // to EXPIRED.
      setCheckout(checkoutData);

      // Refresh inventory.
      await loadInventory(productId);
    } catch (e) {
      console.error(
        'Expire error:',
        e,
      );

      setError(
        e instanceof Error
          ? e.message
          : 'Expire failed',
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="page">
      <h1>Inventory Reservation</h1>

      <p className="sub">
        Keystone Commerce assignment demo
      </p>

      {/* =====================================================
          START CHECKOUT
      ===================================================== */}

      <section className="card">
        <h2>Start Checkout</h2>

        <div className="grid">

          {/* PRODUCT */}

          <label>
            Product

            <select
              value={productId}
              onChange={handleProductChange}
              disabled={
                loading ||
                loadingProducts
              }
            >
              <option value="">
                {loadingProducts
                  ? 'Loading products...'
                  : products.length === 0
                    ? 'No products available'
                    : 'Select a product'}
              </option>

              {products.map(
                (product) => (
                  <option
                    key={product.id}
                    value={product.id}
                  >
                    {product.name}
                  </option>
                ),
              )}
            </select>
          </label>

          {/* QUANTITY */}

          <label>
            Quantity

            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => {
                const value =
                  Number(
                    e.target.value,
                  );

                setQuantity(
                  Number.isNaN(value)
                    ? 1
                    : value,
                );
              }}
              disabled={loading}
            />
          </label>

          {/* PINCODE */}

          <label>
            Pincode

            <input
              value={pincode}
              onChange={(e) =>
                setPincode(
                  e.target.value,
                )
              }
              disabled={loading}
            />
          </label>

          {/* CITY */}

          <label>
            City

            <input
              value={city}
              onChange={(e) =>
                setCity(
                  e.target.value,
                )
              }
              disabled={loading}
            />
          </label>

          {/* STATE */}

          <label>
            State

            <input
              value={state}
              onChange={(e) =>
                setState(
                  e.target.value,
                )
              }
              disabled={loading}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={startCheckout}
          disabled={
            loading ||
            loadingProducts ||
            !productId
          }
        >
          {loading
            ? 'Processing...'
            : 'Start Checkout'}
        </button>
      </section>

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {/* =====================================================
          CHECKOUT
      ===================================================== */}

      {checkout && (
        <section className="card">
          <h2>Checkout</h2>

          <p>
            <b>ID:</b>{' '}
            {checkout.id}
          </p>

          <p>
            <b>Product:</b>{' '}
            {checkout.product?.name ??
              products.find(
                (p) =>
                  p.id === productId,
              )?.name ??
              'N/A'}
          </p>

          <p>
            <b>Location:</b>{' '}
            {checkout.location
              ?.name ?? 'N/A'}
          </p>

          <p>
            <b>Quantity:</b>{' '}
            {checkout.quantity}
          </p>

          <p>
            <b>Status:</b>{' '}
            <span className="status">
              {checkout.status}
            </span>
          </p>

          {/* RESERVED */}

          {checkout.status ===
            'RESERVED' && (
            <div className="actions">

              <button
                type="button"
                onClick={() =>
                  transition(
                    'success',
                  )
                }
                disabled={loading}
              >
                Payment Success
              </button>

              <button
                type="button"
                onClick={() =>
                  transition(
                    'fail',
                  )
                }
                disabled={loading}
              >
                Payment Failed
              </button>

              <button
                type="button"
                onClick={() =>
                  transition(
                    'abandon',
                  )
                }
                disabled={loading}
              >
                Abandon
              </button>

            </div>
          )}

          {/* ABANDONED */}

          {checkout.status ===
            'ABANDONED' && (
            <div className="actions">

              <button
                type="button"
                onClick={expire}
                disabled={loading}
              >
                {loading
                  ? 'Processing...'
                  : 'Expire Abandoned'}
              </button>

            </div>
          )}

          {/* FINAL STATES */}

          {(
            [
              'PAID',
              'FAILED',
              'EXPIRED',
            ] as string[]
          ).includes(
            checkout.status,
          ) && (
            <p>
              Checkout completed with
              status:{' '}
              <b>
                {checkout.status}
              </b>
            </p>
          )}
        </section>
      )}

      {/* =====================================================
          AVAILABILITY
      ===================================================== */}

      <section className="card">
        <h2>Availability</h2>

        <p>
          Total available:{' '}
          <b>{availableTotal}</b>
        </p>

        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Stock</th>
              <th>Reserved</th>
              <th>Available</th>
            </tr>
          </thead>

          <tbody>
            {inventory.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                >
                  No inventory found for
                  selected product.
                </td>
              </tr>
            ) : (
              inventory.map(
                (item, index) => (
                  <tr
                    key={
                      item.id ??
                      `${item.location.id}-${index}`
                    }
                  >
                    <td>
                      {
                        item.location
                          .name
                      }
                    </td>

                    <td>
                      {item.stock}
                    </td>

                    <td>
                      {item.reserved}
                    </td>

                    <td>
                      {Math.max(
                        0,
                        item.stock -
                          item.reserved,
                      )}
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </section>

      {/* =====================================================
          ACTIVE LOCATIONS
      ===================================================== */}

      <section className="card">
        <h2>Active Locations</h2>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>City</th>
              <th>State</th>
              <th>Priority</th>
            </tr>
          </thead>

          <tbody>
            {locations
              .filter(
                (location) =>
                  location.active,
              )
              .map(
                (location) => (
                  <tr
                    key={location.id}
                  >
                    <td>
                      {location.name}
                    </td>

                    <td>
                      {location.city}
                    </td>

                    <td>
                      {location.state}
                    </td>

                    <td>
                      {location.priority}
                    </td>
                  </tr>
                ),
              )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

createRoot(
  document.getElementById(
    'root',
  )!,
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
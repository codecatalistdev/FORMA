const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const util = require("./data/util");

const PORT = Number(process.env.PORT) || 3010;
const DATA_DIR = path.join(__dirname, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const CART_FILE = path.join(DATA_DIR, "cart.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

const TAX_RATE = 0.08;
const SHIPPING_CENTS = 1200;
const FREE_SHIPPING_AT = 15000;
const STATUSES = ["placed", "packed", "shipped"];
const SIZES = [6, 7, 8, 9, 10, 11, 12, 13];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let queue = Promise.resolve();

function withLock(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, data) {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadStore() {
  return withLock(async () => {
    const [products, cart, orders] = await Promise.all([
      readJson(PRODUCTS_FILE),
      readJson(CART_FILE),
      readJson(ORDERS_FILE),
    ]);
    return { products, cart, orders };
  });
}

function changeStore(mutator) {
  return withLock(async () => {
    const products = await readJson(PRODUCTS_FILE);
    const cart = await readJson(CART_FILE);
    const orders = await readJson(ORDERS_FILE);
    const result = mutator({ products, cart, orders });
    if (result.products) await writeJson(PRODUCTS_FILE, result.products);
    if (result.cart) await writeJson(CART_FILE, result.cart);
    if (result.orders) await writeJson(ORDERS_FILE, result.orders);
    return result.value;
  });
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function parseQty(value, { allowZero = false } = {}) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity)) return null;
  if (quantity === 0 && allowZero) return 0;
  if (quantity < 1 || quantity > 8) return null;
  return quantity;
}

function parseSize(value) {
  const size = Number(value);
  if (!SIZES.includes(size)) return null;
  return size;
}

function summaryFor(lines) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_AT ? 0 : SHIPPING_CENTS;
  const tax = Math.round(subtotal * TAX_RATE);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    subtotal,
    shipping,
    tax,
    total: subtotal + shipping + tax,
    count,
    freeShippingAt: FREE_SHIPPING_AT,
  };
}

function sameLine(line, productId, size) {
  return line.productId === productId && Number(line.size) === Number(size);
}

function presentCart(cart, products) {
  const items = cart.items.map((line) => {
    const product = products.find((item) => item.id === line.productId);
    if (!product) {
      return {
        productId: line.productId,
        size: line.size,
        name: "Unavailable shoe",
        category: "",
        color: "",
        price: 0,
        quantity: line.quantity,
        lineTotal: 0,
        image: "",
        missing: true,
        overStock: true,
      };
    }
    return {
      productId: product.id,
      size: line.size,
      name: product.name,
      category: product.category,
      color: product.color,
      price: product.price,
      quantity: line.quantity,
      lineTotal: product.price * line.quantity,
      image: product.image,
      stock: product.stock,
      missing: false,
      overStock: line.quantity > product.stock,
    };
  });
  return { items, summary: summaryFor(items.filter((item) => !item.missing)) };
}

function listProducts(products, query) {
  const q = cleanText(query.q || "", 80).toLowerCase();
  const category = cleanText(query.category || "", 40);
  const categories = [...new Set(products.map((product) => product.category))];
  const filtered = products.filter((product) => {
    const matchesCategory = !category || category === "All" || product.category === category;
    const haystack = `${product.name} ${product.color} ${product.blurb} ${product.category}`.toLowerCase();
    return matchesCategory && (!q || haystack.includes(q));
  });
  return { products: filtered, categories, sizes: SIZES };
}

function customerFrom(body) {
  const customer = {
    name: cleanText(body?.name, 80),
    email: cleanText(body?.email, 120),
    line1: cleanText(body?.line1, 120),
    city: cleanText(body?.city, 80),
    region: cleanText(body?.region, 40),
    postal: cleanText(body?.postal, 12),
  };
  if (customer.name.length < 2) throw new HttpError(400, "Enter the name for this order.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  if (customer.line1.length < 4) throw new HttpError(400, "Enter a street address.");
  if (customer.city.length < 2) throw new HttpError(400, "Enter a city.");
  if (customer.region.length < 2) throw new HttpError(400, "Enter a state or region.");
  if (customer.postal.length < 3) throw new HttpError(400, "Enter a postal code.");
  return customer;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/products", async (req, res, next) => {
  try {
    const { products } = await loadStore();
    res.json(listProducts(products, req.query));
  } catch (error) {
    next(error);
  }
});

app.get("/api/products/:id", async (req, res, next) => {
  try {
    const { products } = await loadStore();
    const product = products.find((item) => item.id === req.params.id);
    if (!product) throw new HttpError(404, "That shoe is not in the catalog.");
    res.json({ ...product, allSizes: SIZES });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cart", async (_req, res, next) => {
  try {
    const { products, cart } = await loadStore();
    res.json(presentCart(cart, products));
  } catch (error) {
    next(error);
  }
});

app.post("/api/cart", async (req, res, next) => {
  try {
    const productId = cleanText(req.body?.productId, 40);
    const size = parseSize(req.body?.size);
    const quantity = parseQty(req.body?.quantity ?? 1);
    if (!productId || size == null || quantity == null) {
      throw new HttpError(400, "Choose a shoe, a size, and a quantity from 1 to 8.");
    }

    const value = await changeStore(({ products, cart }) => {
      const product = products.find((item) => item.id === productId);
      if (!product) throw new HttpError(404, "That shoe is not in the catalog.");
      if (product.stock < 1 || !product.sizes.includes(size)) {
        throw new HttpError(400, `${product.name} is not available in size ${size}.`);
      }
      const items = cart.items.map((line) => ({ ...line }));
      const line = items.find((item) => sameLine(item, productId, size));
      const nextQty = (line?.quantity || 0) + quantity;
      if (nextQty > product.stock) {
        throw new HttpError(400, `Only ${product.stock} of ${product.name} left.`);
      }
      if (nextQty > 8) throw new HttpError(400, "You can add up to 8 of one size.");
      if (line) line.quantity = nextQty;
      else items.push({ productId, size, quantity: nextQty });
      const nextCart = { items };
      return { cart: nextCart, value: presentCart(nextCart, products) };
    });

    res.status(201).json(value);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/cart/:productId/:size", async (req, res, next) => {
  try {
    const size = parseSize(req.params.size);
    const quantity = parseQty(req.body?.quantity, { allowZero: true });
    if (size == null || quantity == null) {
      throw new HttpError(400, "Quantity must be a whole number from 0 to 8.");
    }

    const value = await changeStore(({ products, cart }) => {
      const product = products.find((item) => item.id === req.params.productId);
      if (!product) throw new HttpError(404, "That pair is not in the bag.");
      if (!cart.items.some((line) => sameLine(line, product.id, size))) {
        throw new HttpError(404, "That pair is not in the bag.");
      }
      if (quantity > product.stock) {
        throw new HttpError(400, `Only ${product.stock} of ${product.name} left.`);
      }
      const items =
        quantity === 0
          ? cart.items.filter((line) => !sameLine(line, product.id, size))
          : cart.items.map((line) =>
              sameLine(line, product.id, size) ? { ...line, quantity } : line
            );
      const nextCart = { items };
      return { cart: nextCart, value: presentCart(nextCart, products) };
    });

    res.json(value);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/cart/:productId/:size", async (req, res, next) => {
  try {
    const size = parseSize(req.params.size);
    if (size == null) throw new HttpError(400, "That size is not valid.");
    const value = await changeStore(({ products, cart }) => {
      const items = cart.items.filter((line) => !sameLine(line, req.params.productId, size));
      if (items.length === cart.items.length) throw new HttpError(404, "That pair is not in the bag.");
      const nextCart = { items };
      return { cart: nextCart, value: presentCart(nextCart, products) };
    });
    res.json(value);
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders", async (_req, res, next) => {
  try {
    const { orders } = await loadStore();
    res.json({ orders });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", async (req, res, next) => {
  try {
    const customer = customerFrom(req.body);
    const order = await changeStore(({ products, cart, orders }) => {
      if (!cart.items.length) throw new HttpError(400, "Your bag is empty.");
      const items = cart.items.map((line) => {
        const product = products.find((item) => item.id === line.productId);
        if (!product) throw new HttpError(400, "A bag item is no longer sold.");
        if (!product.sizes.includes(Number(line.size)) || line.quantity > product.stock) {
          throw new HttpError(400, `${product.name} in size ${line.size} is no longer available.`);
        }
        return {
          productId: product.id,
          name: product.name,
          size: line.size,
          color: product.color,
          image: product.image,
          price: product.price,
          quantity: line.quantity,
          lineTotal: product.price * line.quantity,
        };
      });
      const nextProducts = products.map((product) => {
        const taken = items
          .filter((item) => item.productId === product.id)
          .reduce((sum, item) => sum + item.quantity, 0);
        if (!taken) return product;
        return { ...product, stock: product.stock - taken };
      });
      const created = {
        id: crypto.randomUUID(),
        number: `FM-${2400 + orders.length + 1}`,
        createdAt: new Date().toISOString(),
        status: "placed",
        customer,
        items,
        summary: summaryFor(items),
      };
      return {
        products: nextProducts,
        cart: { items: [] },
        orders: [created, ...orders],
        value: created,
      };
    });
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/orders/:id", async (req, res, next) => {
  try {
    const status = cleanText(req.body?.status, 20);
    if (!STATUSES.includes(status)) {
      throw new HttpError(400, "Status must be placed, packed, or shipped.");
    }
    const updated = await changeStore(({ orders }) => {
      const index = orders.findIndex((order) => order.id === req.params.id);
      if (index === -1) throw new HttpError(404, "That order was not found.");
      const current = STATUSES.indexOf(orders[index].status);
      const next = STATUSES.indexOf(status);
      if (next < current) throw new HttpError(400, "An order cannot move backward.");
      const copy = orders.slice();
      copy[index] = { ...orders[index], status };
      return { orders: copy, value: copy[index] };
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status === 500) console.error(error);
  res.status(status).json({
    error: status === 500 ? "Something went wrong saving the shop." : error.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`Shop API listening on http://localhost:${PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw error;
});

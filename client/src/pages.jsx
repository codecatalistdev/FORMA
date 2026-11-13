import { useEffect, useMemo, useState } from "react";
import { api, formatWhen, money } from "./api.js";
import { ProductCard, Summary } from "./components.jsx";
import { EMPTY_CART, useShop } from "./store.jsx";

const ALL_SIZES = [6, 7, 8, 9, 10, 11, 12, 13];
const NEXT_STATUS = { placed: "packed", packed: "shipped" };
const STATUS_LABEL = { placed: "Placed", packed: "Packed", shipped: "Shipped" };

function useCatalog() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useShop();

  useEffect(() => {
    let cancelled = false;
    api("/api/products")
      .then((data) => {
        if (cancelled) return;
        setProducts(data.products);
        setCategories(data.categories);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  return { products, categories, loading };
}

export function Home() {
  const { go } = useShop();
  const { products } = useCatalog();
  const fresh = products.filter((product) => product.badge === "New").slice(0, 4);
  const marked = products.filter((product) => product.compareAt);

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Spring drop 02</p>
          <h1>Run lighter. Look sharper.</h1>
          <p>Daily trainers, court shoes, and leather lows. Built to be worn hard and kept clean.</p>
          <div className="hero-actions">
            <button type="button" className="btn" onClick={() => go("/shop?cat=Running")}>
              Shop running
            </button>
            <button type="button" className="btn ghost" onClick={() => go("/shop")}>
              Shop all
            </button>
          </div>
        </div>
        <button type="button" className="hero-photo" onClick={() => go("/product/relay-runner")}>
          <img src="/shoes/relay.jpg" alt="Relay Runner on the road" />
        </button>
      </section>

      <section className="section wrap">
        <h2>Shop by category</h2>
        <div className="cats">
          {[
            ["Running", "/shoes/trail.jpg", "/shop?cat=Running"],
            ["Lifestyle", "/shoes/mono.jpg", "/shop?cat=Lifestyle"],
            ["Court", "/shoes/court.jpg", "/shop?cat=Court"],
            ["Boots", "/shoes/boot.jpg", "/shop?cat=Boots"],
          ].map(([label, image, href]) => (
            <button key={label} type="button" className="cat" onClick={() => go(href)}>
              <img src={image} alt="" />
              <strong>{label}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="section wrap">
        <div className="section-head">
          <h2>Just landed</h2>
          <button type="button" className="text" onClick={() => go("/shop?sort=new")}>
            View all
          </button>
        </div>
        <div className="grid">
          {fresh.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      <section className="band">
        <button type="button" className="band-photo" onClick={() => go("/product/night-mesh")}>
          <img src="/shoes/night.jpg" alt="Night Mesh" />
        </button>
        <div className="band-copy">
          <p className="eyebrow">Marked down</p>
          <h2>Night Mesh, now $160.</h2>
          <p>The race-day shoe from last season. Same foam, lower price, while the ink colorway is in stock.</p>
          <button type="button" className="btn" onClick={() => go("/product/night-mesh")}>
            Shop the sale
          </button>
        </div>
      </section>

      {marked.length ? (
        <section className="section wrap">
          <h2>On sale</h2>
          <div className="grid">
            {marked.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export function ShopPage() {
  const { go, search } = useShop();
  const { products, categories, loading } = useCatalog();
  const cat = search.get("cat") || "All";
  const q = search.get("q") || "";
  const size = search.get("size") || "";
  const sort = search.get("sort") || "featured";

  function update(next) {
    const params = new URLSearchParams(search);
    Object.entries(next).forEach(([key, value]) => {
      if (!value || value === "All" || value === "featured") params.delete(key);
      else params.set(key, value);
    });
    const qs = params.toString();
    go(`/shop${qs ? `?${qs}` : ""}`);
  }

  const visible = useMemo(() => {
    let list = products.filter((product) => {
      const matchesCat = cat === "All" || product.category === cat;
      const matchesSize = !size || product.sizes.includes(Number(size));
      const haystack = `${product.name} ${product.color} ${product.category}`.toLowerCase();
      const matchesQ = !q || haystack.includes(q.toLowerCase());
      return matchesCat && matchesSize && matchesQ;
    });
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "new") list = [...list].sort((a, b) => (b.badge === "New") - (a.badge === "New"));
    return list;
  }, [products, cat, q, size, sort]);

  const title = q ? `Results for “${q}”` : cat === "All" ? "All shoes" : cat;

  return (
    <main className="wrap shop-page">
      <p className="crumb">Home / Shop{cat !== "All" ? ` / ${cat}` : ""}</p>
      <div className="shop-top">
        <div>
          <h1>{title}</h1>
          <p className="muted">{loading ? "Loading…" : `${visible.length} pairs`}</p>
        </div>
        <label className="sort">
          Sort
          <select value={sort} onChange={(event) => update({ sort: event.target.value })}>
            <option value="featured">Featured</option>
            <option value="new">New</option>
            <option value="price-asc">Price, low to high</option>
            <option value="price-desc">Price, high to low</option>
          </select>
        </label>
      </div>
      <div className="shop-layout">
        <aside className="filters">
          <h3>Category</h3>
          {["All", ...categories].map((item) => (
            <button
              key={item}
              type="button"
              className={cat === item ? "filter-btn is-on" : "filter-btn"}
              onClick={() => update({ cat: item })}
            >
              {item}
            </button>
          ))}
          <h3>Size</h3>
          <div className="sizes">
            {ALL_SIZES.map((item) => (
              <button
                key={item}
                type="button"
                className={String(item) === size ? "size is-on" : "size"}
                onClick={() => update({ size: String(item) === size ? "" : String(item) })}
              >
                {item}
              </button>
            ))}
          </div>
          {size ? (
            <button type="button" className="text" onClick={() => update({ size: "" })}>
              Clear size
            </button>
          ) : null}
        </aside>
        {visible.length === 0 && !loading ? (
          <p className="empty">No shoes match those filters.</p>
        ) : (
          <div className="grid shop-grid">
            {visible.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export function ProductPage() {
  const { path, go, setCart, setError } = useShop();
  const id = decodeURIComponent(path.split("/")[2] || "");
  const [product, setProduct] = useState(null);
  const [missing, setMissing] = useState(false);
  const [size, setSize] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setMissing(false);
    setSize(null);
    setAdded(false);
    api(`/api/products/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!cancelled) setProduct(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.message.includes("not in the catalog")) setMissing(true);
        else setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, setError]);

  async function add(event) {
    event.preventDefault();
    if (!size) {
      setError("Choose a size.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await api("/api/cart", {
        method: "POST",
        body: JSON.stringify({ productId: product.id, size, quantity }),
      });
      setCart(next);
      setAdded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <main className="wrap shop-page">
        <h1>That shoe is gone.</h1>
        <button type="button" className="btn dark" onClick={() => go("/shop")}>
          Back to the shop
        </button>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="wrap shop-page">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const sizes = product.allSizes || ALL_SIZES;
  const soldOut = product.stock < 1;

  return (
    <main className="wrap shop-page">
      <p className="crumb">
        <button type="button" onClick={() => go("/")}>Home</button>
        {" / "}
        <button type="button" onClick={() => go(`/shop?cat=${encodeURIComponent(product.category)}`)}>
          {product.category}
        </button>
        {" / "}
        {product.name}
      </p>
      <div className="pdp">
        <div className="pdp-photo">
          <img src={product.image} alt={product.name} />
        </div>
        <div className="buybox">
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}</h1>
          <p className="buy-price">
            {product.compareAt ? <s>{money(product.compareAt)}</s> : null}
            <b>{money(product.price)}</b>
          </p>
          <p className="muted">{product.color} · {soldOut ? "Sold out" : `${product.stock} in stock`}</p>
          <p className="detail-copy">{product.detail}</p>
          <form onSubmit={add}>
            <p className="label">Size {size ? `— US ${size}` : ""}</p>
            <div className="sizes sizes-lg">
              {sizes.map((item) => {
                const open = product.sizes.includes(item) && !soldOut;
                return (
                  <button
                    key={item}
                    type="button"
                    className={size === item ? "size is-on" : "size"}
                    disabled={!open}
                    onClick={() => setSize(item)}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            <label className="qty">
              Qty
              <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} disabled={soldOut}>
                {[1, 2, 3, 4].map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn dark block" disabled={soldOut || busy}>
              {soldOut ? "Sold out" : busy ? "Adding…" : "Add to bag"}
            </button>
            {added ? (
              <p className="added">
                Added. <button type="button" onClick={() => go("/cart")}>View bag</button>
              </p>
            ) : null}
          </form>
          <ul className="facts">
            <li>Free shipping over $150</li>
            <li>Free returns within 30 days</li>
            <li>Ships from the test warehouse</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

export function CartPage() {
  const { cart, setCart, go, setError } = useShop();
  const [pending, setPending] = useState("");

  async function update(item, quantity) {
    setPending(`${item.productId}-${item.size}`);
    setError("");
    try {
      const next = await api(`/api/cart/${encodeURIComponent(item.productId)}/${item.size}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      });
      setCart(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending("");
    }
  }

  if (!cart.items.length) {
    return (
      <main className="wrap shop-page narrow">
        <h1>Your bag is empty.</h1>
        <p className="muted">When you find a pair, it will wait here.</p>
        <button type="button" className="btn dark" onClick={() => go("/shop")}>
          Shop shoes
        </button>
      </main>
    );
  }

  return (
    <main className="wrap shop-page">
      <h1>Your bag</h1>
      <div className="split">
        <ul className="lines">
          {cart.items.map((item) => (
            <li key={`${item.productId}-${item.size}`}>
              <button type="button" className="line-photo" onClick={() => go(`/product/${item.productId}`)}>
                {item.image ? <img src={item.image} alt="" /> : null}
              </button>
              <div>
                <strong>{item.name}</strong>
                <span className="muted">Size {item.size} · {item.color}</span>
                {item.overStock ? <span className="sale-text">More than we have left.</span> : null}
                <button type="button" className="text" onClick={() => update(item, 0)}>
                  Remove
                </button>
              </div>
              <label>
                <span className="sr-only">Quantity</span>
                <select
                  value={item.quantity}
                  disabled={pending === `${item.productId}-${item.size}`}
                  onChange={(event) => update(item, Number(event.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <b>{money(item.lineTotal)}</b>
            </li>
          ))}
        </ul>
        <Summary
          summary={cart.summary}
          action="Checkout"
          disabled={cart.items.some((item) => item.overStock || item.missing)}
          onAction={() => go("/checkout")}
        />
      </div>
    </main>
  );
}

export function CheckoutPage() {
  const { cart, setCart, go, setError } = useShop();
  const [form, setForm] = useState({
    name: "Avery Cole",
    email: "avery@example.com",
    line1: "18 Cedar Street",
    city: "Portland",
    region: "Maine",
    postal: "04101",
  });
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const order = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setCart(EMPTY_CART);
      go("/confirmed", { order });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!cart.items.length) {
    return (
      <main className="wrap shop-page narrow">
        <h1>Nothing to check out.</h1>
        <button type="button" className="btn dark" onClick={() => go("/shop")}>
          Shop shoes
        </button>
      </main>
    );
  }

  return (
    <main className="wrap shop-page">
      <h1>Checkout</h1>
      <div className="split">
        <form className="checkout" onSubmit={submit}>
          <p className="muted">A sample address is filled in so you can place a test order.</p>
          {[
            ["name", "Full name"],
            ["email", "Email"],
            ["line1", "Street"],
            ["city", "City"],
            ["region", "State"],
            ["postal", "Postal code"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input value={form[key]} autoComplete="off" onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
            </label>
          ))}
          <button type="submit" className="btn dark block" disabled={busy}>
            {busy ? "Placing order…" : `Pay ${money(cart.summary.total)}`}
          </button>
        </form>
        <Summary summary={cart.summary} />
      </div>
    </main>
  );
}

export function ConfirmedPage() {
  const { go } = useShop();
  const order = window.history.state?.order;
  if (!order) {
    return (
      <main className="wrap shop-page narrow">
        <h1>No recent order.</h1>
        <button type="button" className="btn dark" onClick={() => go("/orders")}>
          Order history
        </button>
      </main>
    );
  }
  return (
    <main className="wrap shop-page narrow">
      <p className="eyebrow">Order {order.number}</p>
      <h1>You’re in.</h1>
      <p className="muted">
        We’d email {order.customer.email}. This test shop saved the order in orders.json.
      </p>
      <p>
        {order.summary.count} pair{order.summary.count === 1 ? "" : "s"} · {money(order.summary.total)}
      </p>
      <div className="hero-actions">
        <button type="button" className="btn dark" onClick={() => go("/orders")}>
          Track order
        </button>
        <button type="button" className="btn line" onClick={() => go("/shop")}>
          Keep shopping
        </button>
      </div>
    </main>
  );
}

export function OrdersPage() {
  const { setError } = useShop();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");

  useEffect(() => {
    api("/api/orders")
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [setError]);

  async function advance(order) {
    const status = NEXT_STATUS[order.status];
    if (!status) return;
    setPending(order.id);
    try {
      const updated = await api(`/api/orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setOrders((list) => list.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err.message);
    } finally {
      setPending("");
    }
  }

  return (
    <main className="wrap shop-page">
      <h1>Orders</h1>
      {loading ? <p className="muted">Loading…</p> : null}
      {!loading && orders.length === 0 ? (
        <p className="muted">No orders yet. Checkout from the bag to create one.</p>
      ) : (
        <ul className="orders">
          {orders.map((order) => (
            <li key={order.id}>
              <div className="order-top">
                <div>
                  <strong>{order.number}</strong>
                  <span className="muted">{formatWhen(order.createdAt)}</span>
                </div>
                <span className={`pill pill-${order.status}`}>{STATUS_LABEL[order.status]}</span>
              </div>
              <ul>
                {order.items.map((item) => (
                  <li key={`${item.productId}-${item.size}`}>
                    <span className="thumb">{item.image ? <img src={item.image} alt="" /> : null}</span>
                    <span>{item.name} · Size {item.size} · Qty {item.quantity}</span>
                    <b>{money(item.lineTotal)}</b>
                  </li>
                ))}
              </ul>
              <p className="muted">
                {order.customer.name}, {order.customer.line1}, {order.customer.city} {order.customer.region} {order.customer.postal}
              </p>
              <div className="order-foot">
                <span>Total {money(order.summary.total)}</span>
                {NEXT_STATUS[order.status] ? (
                  <button type="button" className="btn dark" disabled={pending === order.id} onClick={() => advance(order)}>
                    Mark {STATUS_LABEL[NEXT_STATUS[order.status]].toLowerCase()}
                  </button>
                ) : (
                  <span className="muted">Fulfilled</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function AboutPage() {
  const { go } = useShop();
  return (
    <main>
      <section className="band about-band">
        <div className="band-copy">
          <p className="eyebrow">The house</p>
          <h2>Shoes with nothing extra on them.</h2>
          <p>
            FORMA is a test storefront: a catalog, a bag, checkout, and order tracking. No account system and no database — the JSON files are the stock room.
          </p>
          <button type="button" className="btn" onClick={() => go("/shop")}>
            See the shoes
          </button>
        </div>
        <div className="band-photo">
          <img src="/shoes/boot.jpg" alt="Field Boot" />
        </div>
      </section>
      <section className="section wrap about-points">
        <div>
          <h3>01</h3>
          <p>Pick a pair, a size, and a quantity. Stock updates when the order is placed.</p>
        </div>
        <div>
          <h3>02</h3>
          <p>Shipping is $12, or free over $150. Tax is 8% of the shoe price.</p>
        </div>
        <div>
          <h3>03</h3>
          <p>Orders move from placed to packed to shipped on the orders page.</p>
        </div>
      </section>
    </main>
  );
}

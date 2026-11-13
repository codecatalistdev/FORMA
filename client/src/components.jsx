import { useState } from "react";
import { money } from "./api.js";
import { useShop } from "./store.jsx";

const NAV = [
  { href: "/shop?sort=new", label: "New" },
  { href: "/shop?cat=Running", label: "Running" },
  { href: "/shop?cat=Lifestyle", label: "Lifestyle" },
  { href: "/shop?cat=Court", label: "Court" },
  { href: "/shop?cat=Boots", label: "Boots" },
];

export function Header() {
  const { go, path, cart } = useShop();
  const [query, setQuery] = useState("");
  const count = cart.summary?.count || 0;

  function search(event) {
    event.preventDefault();
    const q = query.trim();
    go(q ? `/shop?q=${encodeURIComponent(q)}` : "/shop");
  }

  return (
    <>
      <div className="announce">Free shipping over $150 · Free returns within 30 days</div>
      <header className="header">
        <button type="button" className="logo" onClick={() => go("/")}>
          FORMA
        </button>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.href}
              type="button"
              className={path === "/shop" && item.href.includes("cat") ? "" : ""}
              onClick={() => go(item.href)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => go("/about")}>
            About
          </button>
        </nav>
        <div className="tools">
          <form onSubmit={search}>
            <input
              className="search"
              value={query}
              placeholder="Search"
              aria-label="Search shoes"
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
          <button type="button" className={path === "/orders" ? "text is-on" : "text"} onClick={() => go("/orders")}>
            Orders
          </button>
          <button type="button" className="bag" onClick={() => go("/cart")}>
            Bag ({count})
          </button>
        </div>
      </header>
    </>
  );
}

export function Footer() {
  const { go } = useShop();
  return (
    <footer className="footer wrap">
      <div>
        <strong>FORMA</strong>
        <p>Shoes for the city and the long run. A test shop — catalog, bag, and orders live in JSON.</p>
      </div>
      <div>
        <p className="label">Shop</p>
        <button type="button" onClick={() => go("/shop")}>All shoes</button>
        <button type="button" onClick={() => go("/shop?cat=Running")}>Running</button>
        <button type="button" onClick={() => go("/shop?sort=price-asc")}>Sale</button>
      </div>
      <div>
        <p className="label">Help</p>
        <button type="button" onClick={() => go("/orders")}>Order history</button>
        <button type="button" onClick={() => go("/cart")}>Your bag</button>
      </div>
      <div>
        <p className="label">House</p>
        <button type="button" onClick={() => go("/about")}>About FORMA</button>
        <button type="button" onClick={() => go("/")}>Home</button>
      </div>
    </footer>
  );
}

export function ProductCard({ product }) {
  const { go } = useShop();
  const sale = product.badge === "Sale" || product.badge === "Sold out";
  return (
    <button type="button" className="pcard" onClick={() => go(`/product/${product.id}`)}>
      <span className="pcard-photo">
        {product.badge ? <em className={sale ? "flag sale" : "flag"}>{product.badge}</em> : null}
        <img src={product.image} alt="" />
      </span>
      <span className="pcard-meta">
        <strong>{product.name}</strong>
        <span>{product.color}</span>
      </span>
      <span className="pcard-price">
        {product.compareAt ? <s>{money(product.compareAt)}</s> : null}
        <b>{money(product.price)}</b>
      </span>
    </button>
  );
}

export function Summary({ summary, action, onAction, disabled }) {
  const remain = Math.max(0, (summary.freeShippingAt || 15000) - summary.subtotal);
  return (
    <aside className="summary">
      <h2>Summary</h2>
      <p><span>Subtotal</span><span>{money(summary.subtotal)}</span></p>
      <p><span>Shipping</span><span>{summary.shipping === 0 ? "Free" : money(summary.shipping)}</span></p>
      <p><span>Tax</span><span>{money(summary.tax)}</span></p>
      <p className="total"><span>Total</span><span>{money(summary.total)}</span></p>
      <p className="fine">
        {summary.subtotal === 0
          ? "Free shipping over $150."
          : remain > 0
            ? `${money(remain)} away from free shipping.`
            : "You’ve got free shipping."}
      </p>
      {action ? (
        <button type="button" className="btn dark block" disabled={disabled} onClick={onAction}>
          {action}
        </button>
      ) : null}
    </aside>
  );
}

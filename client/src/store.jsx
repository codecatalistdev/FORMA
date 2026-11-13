import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

const ShopContext = createContext(null);

export const EMPTY_CART = {
  items: [],
  summary: { subtotal: 0, shipping: 0, tax: 0, total: 0, count: 0, freeShippingAt: 15000 },
};

export function useShop() {
  return useContext(ShopContext);
}

export function ShopProvider({ children }) {
  const [href, setHref] = useState(() => window.location.pathname + window.location.search);
  const [cart, setCart] = useState(EMPTY_CART);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setHref(window.location.pathname + window.location.search);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    api("/api/cart")
      .then(setCart)
      .catch((err) => setError(err.message));
  }, []);

  function go(to, state) {
    window.history.pushState(state || {}, "", to);
    setHref(to);
    setError("");
    window.scrollTo(0, 0);
  }

  const url = new URL(href, "http://forma.local");

  return (
    <ShopContext.Provider
      value={{
        go,
        path: url.pathname,
        search: url.searchParams,
        cart,
        setCart,
        error,
        setError,
      }}
    >
      {children}
    </ShopContext.Provider>
  );
}

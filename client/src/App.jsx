import { Footer, Header } from "./components.jsx";
import {
  AboutPage,
  CartPage,
  CheckoutPage,
  ConfirmedPage,
  Home,
  OrdersPage,
  ProductPage,
  ShopPage,
} from "./pages.jsx";
import { ShopProvider, useShop } from "./store.jsx";

function Frame() {
  const { path, error, setError } = useShop();
  let page = <Home />;
  if (path === "/shop") page = <ShopPage />;
  else if (path.startsWith("/product/")) page = <ProductPage />;
  else if (path === "/cart") page = <CartPage />;
  else if (path === "/checkout") page = <CheckoutPage />;
  else if (path === "/orders") page = <OrdersPage />;
  else if (path === "/about") page = <AboutPage />;
  else if (path === "/confirmed") page = <ConfirmedPage />;

  return (
    <>
      <Header />
      {error ? (
        <p className="alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </p>
      ) : null}
      {page}
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <ShopProvider>
      <Frame />
    </ShopProvider>
  );
}

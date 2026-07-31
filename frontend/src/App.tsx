import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import Stores from "./pages/Stores";
import StoreDetail from "./pages/StoreDetail";
import ServiceDetail from "./pages/ServiceDetail";
import ProductDetail from "./pages/ProductDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import MyAppointments from "./pages/MyAppointments";
import Dashboard from "./pages/Dashboard";
import Favorites from "./pages/Favorites";
import Cart from "./pages/Cart";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import MyOrders from "./pages/MyOrders";
import Marketplace from "./pages/Marketplace";
import Admin from "./pages/Admin";

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route path="/" element={<Stores />} />
                <Route path="/mercado" element={<Marketplace />} />
                <Route path="/negocios/:storeId" element={<StoreDetail />} />
                <Route path="/servicios/:serviceId" element={<ServiceDetail />} />
                <Route path="/productos/:productId" element={<ProductDetail />} />
                <Route path="/login" element={<Login />} />
                <Route path="/registro" element={<Register />} />
                <Route
                    path="/mis-citas"
                    element={
                        <RequireAuth>
                            <MyAppointments />
                        </RequireAuth>
                    }
                />
                <Route
                    path="/favoritos"
                    element={
                        <RequireAuth>
                            <Favorites />
                        </RequireAuth>
                    }
                />
                <Route
                    path="/carrito"
                    element={
                        <RequireAuth>
                            <Cart />
                        </RequireAuth>
                    }
                />
                <Route
                    path="/carrito/exito"
                    element={
                        <RequireAuth>
                            <CheckoutSuccess />
                        </RequireAuth>
                    }
                />
                <Route
                    path="/mis-pedidos"
                    element={
                        <RequireAuth>
                            <MyOrders />
                        </RequireAuth>
                    }
                />
                <Route
                    path="/mi-negocio"
                    element={
                        <RequireAuth>
                            <Dashboard />
                        </RequireAuth>
                    }
                />
                <Route
                    path="/admin"
                    element={
                        <RequireAuth>
                            <Admin />
                        </RequireAuth>
                    }
                />
            </Route>
        </Routes>
    );
}

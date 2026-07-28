import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import Stores from "./pages/Stores";
import StoreDetail from "./pages/StoreDetail";
import ServiceDetail from "./pages/ServiceDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import MyAppointments from "./pages/MyAppointments";
import Dashboard from "./pages/Dashboard";
import Favorites from "./pages/Favorites";

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route path="/" element={<Stores />} />
                <Route path="/negocios/:storeId" element={<StoreDetail />} />
                <Route path="/servicios/:serviceId" element={<ServiceDetail />} />
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
                    path="/mi-negocio"
                    element={
                        <RequireAuth>
                            <Dashboard />
                        </RequireAuth>
                    }
                />
            </Route>
        </Routes>
    );
}

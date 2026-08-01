import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { orderFolio } from "../lib/format";
import type { Order } from "../types";

export default function MyOrders() {
    const location = useLocation();
    const justPlaced = (location.state as { justPlaced?: number } | null)?.justPlaced;

    const [orders, setOrders] = useState<Order[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api
            .get<Order[]>("/orders/me")
            .then(setOrders)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar tus pedidos"));
    }, []);

    if (error) return <p className="error">{error}</p>;
    if (!orders) return <p className="muted">Cargando...</p>;

    return (
        <div>
            <h1>Mis pedidos</h1>
            {justPlaced && (
                <div className="card success">
                    <p>
                        {justPlaced === 1
                            ? "Tu pedido fue registrado."
                            : `Tus ${justPlaced} pedidos fueron registrados (uno por cada negocio).`}{" "}
                        El pago se coordina directamente con cada negocio.
                    </p>
                </div>
            )}
            {orders.length === 0 ? (
                <p className="muted">Todavía no has hecho ningún pedido.</p>
            ) : (
                <div className="card-stack">
                    {orders.map((o) => (
                        <div className="card" key={o.id}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <h3>{o.store_name}</h3>
                                <span className={`badge badge-${o.status === "cancelado" ? "cancelada" : o.status === "entregado" || o.status === "pagado" ? "confirmada" : ""}`}>
                                    {o.status}
                                </span>
                            </div>
                            <p className="muted">Folio: {orderFolio(o.id)}</p>
                            <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                                {o.items.map((it) => (
                                    <li key={it.product_id} className="muted">
                                        {it.quantity} × {it.name} (${it.price_at_purchase})
                                    </li>
                                ))}
                            </ul>
                            <p className="price">Total: ${o.total_amount}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

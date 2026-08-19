import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import Receipt from "../components/Receipt";
import type { Order } from "../types";

export default function CheckoutSuccess() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [orders, setOrders] = useState<Order[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Mercado Pago agrega estos parámetros solo al volver del pago (no
        // los define el frontend, ver back_urls en
        // orders.controller.js#createMercadoPagoCheckoutSession).
        const paymentId = params.get("payment_id");
        const externalReference = params.get("external_reference");
        if (!paymentId || !externalReference) {
            setError("Falta la referencia del pago");
            return;
        }
        api
            .post<Order[]>("/orders/mercadopago/confirm", { payment_id: paymentId, external_reference: externalReference })
            .then(setOrders)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo confirmar el pago"));
    }, [params]);

    if (error) return <p className="error">{error}</p>;
    if (!orders) return <p className="muted">Confirmando tu pago...</p>;

    return (
        <Receipt orders={orders} onClose={() => navigate("/mis-pedidos", { state: { justPlaced: orders.length } })} />
    );
}

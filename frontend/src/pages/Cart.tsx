import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trash } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
import Receipt from "../components/Receipt";
import type { CartItem, Order } from "../types";

// Debe calzar con MERCADOPAGO_CARD_SURCHARGE en orders.controller.js: es
// solo para mostrarle al cliente el total real antes de pagar con tarjeta,
// el cobro de verdad lo define el backend en la preferencia de Mercado Pago.
const CARD_SURCHARGE = 1.12;

export default function Cart() {
    const navigate = useNavigate();
    const [items, setItems] = useState<CartItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [checkingOut, setCheckingOut] = useState(false);
    const [payingStoreId, setPayingStoreId] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<Order[] | null>(null);

    function load() {
        api
            .get<CartItem[]>("/cart")
            .then(setItems)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar tu carrito"));
    }

    useEffect(load, []);

    async function updateQuantity(productId: string, quantity: number) {
        try {
            await api.patch(`/cart/${productId}`, { quantity });
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo actualizar la cantidad");
        }
        load();
    }

    async function remove(productId: string) {
        await api.delete(`/cart/${productId}`);
        load();
    }

    async function checkout() {
        setCheckingOut(true);
        setError(null);
        try {
            const orders = await api.post<Order[]>("/orders");
            setReceipt(orders);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo completar la compra");
            load();
        } finally {
            setCheckingOut(false);
        }
    }

    // Un pago con tarjeta solo puede ir a UNA cuenta de Mercado Pago -- si el
    // carrito tiene productos de varias tiendas, cada una se paga aparte
    // (ver el bloque por negocio más abajo).
    async function checkoutWithCard(storeId: string) {
        setPayingStoreId(storeId);
        setError(null);
        try {
            const { url } = await api.post<{ url: string }>("/orders/mercadopago/checkout-session", {
                store_id: storeId,
            });
            window.location.href = url;
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo iniciar el pago con tarjeta");
            setPayingStoreId(null);
        }
    }

    if (receipt) {
        return (
            <Receipt
                orders={receipt}
                onClose={() => navigate("/mis-pedidos", { state: { justPlaced: receipt.length } })}
            />
        );
    }

    if (error && !items) return <p className="error">{error}</p>;
    if (!items) return <p className="muted">Cargando...</p>;

    const total = items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
    const stores = new Map<string, { name: string; connected: boolean; subtotal: number }>();
    for (const item of items) {
        const entry = stores.get(item.store_id) ?? { name: item.store_name, connected: item.mercadopago_connected, subtotal: 0 };
        entry.subtotal += Number(item.price) * item.quantity;
        stores.set(item.store_id, entry);
    }

    return (
        <div>
            <h1>Tu carrito</h1>
            {items.length === 0 ? (
                <p className="muted">
                    Tu carrito está vacío. <Link to="/">Explora negocios</Link>.
                </p>
            ) : (
                <>
                    <div className="cart-list">
                        {items.map((item) => (
                            <div className="cart-row" key={item.product_id}>
                                {item.image_url && <img src={imageUrl(item.image_url)!} alt="" />}
                                <div className="cart-row-info">
                                    <strong>{item.name}</strong>
                                    <span className="muted">{item.store_name}</span>
                                    <span className="price">${item.price}</span>
                                </div>
                                <input
                                    type="number"
                                    min={1}
                                    max={item.stock}
                                    value={item.quantity}
                                    onChange={(e) => updateQuantity(item.product_id, Number(e.target.value))}
                                    style={{ width: 70 }}
                                />
                                <button className="btn btn-ghost btn-sm" onClick={() => remove(item.product_id)}>
                                    <Trash size={14} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {stores.size > 1 && (
                        <p className="muted">
                            Tu carrito tiene productos de {stores.size} negocios distintos: se genera un pedido por
                            cada uno, y el pago con tarjeta se hace por separado por negocio.
                        </p>
                    )}
                    {error && <p className="error">{error}</p>}
                    <div className="cart-total">
                        <span>Total</span>
                        <strong className="price">${total.toFixed(2)}</strong>
                    </div>

                    <button className="btn btn-ghost" onClick={checkout} disabled={checkingOut}>
                        {checkingOut ? "Procesando..." : "Pagar en persona (todo el carrito)"}
                    </button>

                    <div className="card-stack">
                        {[...stores.entries()].map(([storeId, store]) => (
                            <div className="card" key={storeId}>
                                <strong>{store.name}</strong>
                                <span className="muted"> · ${store.subtotal.toFixed(2)}</span>
                                {store.connected ? (
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => checkoutWithCard(storeId)}
                                        disabled={payingStoreId === storeId}
                                        style={{ marginTop: 8 }}
                                    >
                                        {payingStoreId === storeId
                                            ? "Procesando..."
                                            : `Pagar con tarjeta ($${(store.subtotal * CARD_SURCHARGE).toFixed(2)})`}
                                    </button>
                                ) : (
                                    <p className="muted" style={{ marginTop: 8 }}>
                                        Este negocio aún no acepta pagos con tarjeta.
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="muted">Pagar con tarjeta incluye un 12% adicional. Paga en persona para evitarlo.</p>
                </>
            )}
        </div>
    );
}

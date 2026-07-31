import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trash } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
import Receipt from "../components/Receipt";
import type { CartItem, Order } from "../types";

export default function Cart() {
    const navigate = useNavigate();
    const [items, setItems] = useState<CartItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [checkingOut, setCheckingOut] = useState(false);
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

    async function checkoutWithCard() {
        setCheckingOut(true);
        setError(null);
        try {
            const { url } = await api.post<{ url: string }>("/orders/checkout-session");
            window.location.href = url;
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo iniciar el pago con tarjeta");
            setCheckingOut(false);
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
    const storeCount = new Set(items.map((i) => i.store_id)).size;

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

                    {storeCount > 1 && (
                        <p className="muted">
                            Tu carrito tiene productos de {storeCount} negocios distintos: se generará un pedido por
                            cada uno.
                        </p>
                    )}
                    {error && <p className="error">{error}</p>}
                    <div className="cart-total">
                        <span>Total</span>
                        <strong className="price">${total.toFixed(2)}</strong>
                    </div>
                    <div className="cart-actions">
                        <button className="btn btn-ghost" onClick={checkout} disabled={checkingOut}>
                            {checkingOut ? "Procesando..." : "Pagar en persona"}
                        </button>
                        <button className="btn btn-primary" onClick={checkoutWithCard} disabled={checkingOut}>
                            {checkingOut ? "Procesando..." : "Pagar con tarjeta"}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

import type { Order } from "../types";

const STATUS_LABEL: Record<Order["status"], string> = {
    pendiente: "PENDIENTE",
    pagado: "PAGADO",
    entregado: "ENTREGADO",
    cancelado: "CANCELADO",
};

export default function Receipt({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
    return (
        <div className="ticket-overlay" onClick={onClose}>
            <div className="ticket-stack" onClick={(e) => e.stopPropagation()}>
                {orders.map((o) => (
                    <div className="ticket" key={o.id}>
                        <div className={`ticket-stamp ticket-stamp-${o.status}`}>{STATUS_LABEL[o.status]}</div>
                        <div className="ticket-header">
                            <strong>{o.store_name}</strong>
                            <span className="muted">{new Date(o.created_at).toLocaleString()}</span>
                        </div>
                        <div className="ticket-divider" />
                        <ul className="ticket-items">
                            {o.items.map((it) => (
                                <li key={it.product_id}>
                                    <span>
                                        {it.quantity} × {it.name}
                                    </span>
                                    <span>${(Number(it.price_at_purchase) * it.quantity).toFixed(2)}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="ticket-divider" />
                        <div className="ticket-total">
                            <span>TOTAL</span>
                            <span>${Number(o.total_amount).toFixed(2)}</span>
                        </div>
                    </div>
                ))}
                <button className="btn btn-primary" onClick={onClose}>
                    Ver mis pedidos
                </button>
            </div>
        </div>
    );
}

-- Migración incremental: índices que faltaban en columnas ya usadas como
-- filtro/JOIN en producción (products.store_id, products.category_id,
-- stores.owner_id, order_items.order_id). Sin dato suficiente para que el
-- planner de Postgres los necesite hoy (catálogo chico), pero son baratos de
-- crear ahora y evitan un table scan en cuanto el catálogo crezca.

BEGIN;

-- listForStore (services/products) y search filtran por esto en cada visita
-- pública a una tienda/categoría.
CREATE INDEX idx_products_store ON products(store_id);
CREATE INDEX idx_products_category ON products(category_id);

-- stores.mine (panel del dueño) filtra por esto en cada carga del Dashboard.
CREATE INDEX idx_stores_owner ON stores(owner_id);

-- Se hace JOIN contra esto cada vez que se listan los items de un pedido.
CREATE INDEX idx_order_items_order ON order_items(order_id);

COMMIT;

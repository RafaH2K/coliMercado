import { Link, Outlet, useNavigate } from "react-router-dom";
import { CalendarBlank, Storefront, ShoppingCartSimple, SignOut } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    function handleLogout() {
        logout();
        navigate("/");
    }

    return (
        <div className="app-shell">
            <nav className="nav">
                <Link to="/" className="brand">
                    Mercol
                </Link>
                <div className="nav-links">
                    <div className="nav-group">
                        <Link to="/" className="nav-group-title">
                            <CalendarBlank size={15} /> Negocios
                        </Link>
                        {user && <Link to="/mis-citas">Mis citas</Link>}
                    </div>

                    <div className="nav-group">
                        <Link to="/mercado" className="nav-group-title">
                            <Storefront size={15} /> Mercado
                        </Link>
                        {user && (
                            <Link to="/carrito">
                                <ShoppingCartSimple size={14} /> Carrito
                            </Link>
                        )}
                        {user && <Link to="/mis-pedidos">Pedidos</Link>}
                    </div>

                    {user && <Link to="/favoritos">Favoritos</Link>}
                    {user && <Link to="/mi-negocio">Mi negocio</Link>}
                    {user?.is_admin && <Link to="/admin">Admin</Link>}
                    {user ? (
                        <>
                            <span className="nav-user">{user.email}</span>
                            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
                                <SignOut size={14} /> Salir
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/login">Entrar</Link>
                            <Link to="/registro" className="btn btn-primary btn-sm">
                                Crear cuenta
                            </Link>
                        </>
                    )}
                </div>
            </nav>
            <main className="container">
                <Outlet />
            </main>
        </div>
    );
}

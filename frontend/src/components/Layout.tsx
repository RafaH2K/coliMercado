import { Link, Outlet, useNavigate } from "react-router-dom";
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
                    colimaMerrcado
                </Link>
                <div className="nav-links">
                    <Link to="/">Negocios</Link>
                    {user && <Link to="/favoritos">Favoritos</Link>}
                    {user && <Link to="/mis-citas">Mis citas</Link>}
                    {user && <Link to="/mi-negocio">Mi negocio</Link>}
                    {user ? (
                        <>
                            <span className="nav-user">{user.email}</span>
                            <button className="btn btn-ghost" onClick={handleLogout}>
                                Salir
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

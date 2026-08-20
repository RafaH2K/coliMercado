import { Link } from "react-router-dom";

export default function Footer() {
    return (
        <footer className="footer">
            <div className="footer-links">
                <Link to="/terminos">Términos de servicio</Link>
                <Link to="/privacidad">Privacidad</Link>
                <Link to="/cookies">Cookies</Link>
            </div>
        </footer>
    );
}

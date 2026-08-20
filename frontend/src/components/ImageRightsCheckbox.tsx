// Consentimiento obligatorio antes de subir cualquier imagen (logo, foto de
// producto/servicio) -- el backend lo exige (rights_attested="true" en
// config/upload.js) y guarda un registro auditable de quién lo confirmó.
export default function ImageRightsCheckbox({
    checked,
    onChange,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em" }}>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            Confirmo que tengo los derechos de esta imagen o autorización para usarla
        </label>
    );
}

import { Link } from 'react-router-dom';

const Card = ({ to, title, desc }) => (
  <Link
    to={to}
    className="block bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 hover:border-[#3B82F6] transition-colors"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
  >
    <p className="text-[14px] font-medium text-[#0F172A]">{title}</p>
    <p className="text-[12px] text-[#64748B] mt-0.5">{desc}</p>
  </Link>
);

const SettingsHome = () => (
  <div className="px-6 pt-8 pb-16 max-w-[720px] mx-auto">
    <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Configuración</h1>
    <p className="text-[13px] text-[#475569] mt-0.5 mb-8">Ajustes de tu cuenta y de los usuarios de la tienda.</p>

    <div className="space-y-3">
      <Card
        to="/settings/users"
        title="Usuarios"
        desc="Empleados de la tienda, su rol y la sucursal asignada."
      />
      <Card
        to="/settings/password"
        title="Cambiar contraseña"
        desc="Actualizá tu contraseña de acceso."
      />
    </div>
  </div>
);

export default SettingsHome;

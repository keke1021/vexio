import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SyntraFooter from './SyntraFooter';
import SelectBranch from '../pages/SelectBranch';

// Dead-end para SELLER sin sucursal asignada — no puede operar nada
// (todo el sistema se scopea por sucursal). Un encargado tiene que asignarle
// una desde el panel de Admin. TECH no llega acá: está exento del scope.
const NoBranchAssigned = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-[380px] text-center">
        <div
          className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden p-8"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        >
          <h1 className="text-[17px] font-semibold text-[#0F172A]">Sin sucursal asignada</h1>
          <p className="mt-2 text-[13px] text-[#64748B] leading-relaxed">
            Tu usuario ({user?.name}) todavía no está asignado a ninguna sucursal.
            Pedile a un encargado que te asigne una para poder trabajar.
          </p>
          <button
            onClick={handleLogout}
            className="mt-6 w-full bg-[#1E3A5F] hover:bg-[#182f4d] text-white text-[13px] font-medium py-2.5 rounded-lg transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
      <SyntraFooter variant="fixed" />
    </div>
  );
};

// Guard: la app no monta hasta que la sesión tiene una sucursal activa.
//   - SUPERADMIN: pasa (no está sujeto al scope por sucursal).
//   - TECH: pasa siempre — ve las Reparaciones de todas las sucursales
//     combinadas, no necesita (ni usa) una sucursal asignada. El backend
//     también exime a TECH en requireActiveTienda.
//   - activeTienda seteada: pasa.
//   - sin activeTienda + varias disponibles (OWNER/ADMIN multi-sucursal):
//     pantalla de selección obligatoria.
//   - sin activeTienda + ninguna disponible (SELLER sin asignar): dead-end.
const BranchGate = () => {
  const { user, activeTienda, availableTiendas } = useAuth();

  if (!user) return <Outlet />; // PrivateRoute ya maneja el no-autenticado
  if (user.role === 'SUPERADMIN' || user.role === 'TECH' || activeTienda) return <Outlet />;
  if ((availableTiendas?.length ?? 0) > 0) return <SelectBranch />;
  return <NoBranchAssigned />;
};

export default BranchGate;

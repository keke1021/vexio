import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Smartphone, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SyntraFooter from '../components/SyntraFooter';

// Pantalla de selección obligatoria de sucursal. Se muestra (vía BranchGate)
// cuando un OWNER/ADMIN tiene acceso a más de una sucursal y todavía no eligió
// con cuál trabajar — sin default silencioso. SELLER/TECH nunca la ven (su
// sucursal se auto-asigna en el login).
const SelectBranch = () => {
  const { tenant, availableTiendas, selectTienda, logout } = useAuth();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const pick = async (id) => {
    setBusyId(id);
    setError('');
    try {
      await selectTienda(id);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo entrar a esa sucursal.');
      setBusyId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="w-14 h-14 rounded-2xl bg-[#1E3A5F] flex items-center justify-center"
            style={{ boxShadow: '0 4px 12px rgba(30,58,95,0.25)' }}
          >
            <Smartphone size={26} strokeWidth={2} className="text-white" />
          </div>
          <h1 className="mt-4 text-[22px] font-bold tracking-tight text-[#1E3A5F]">Elegí una sucursal</h1>
          <p className="mt-1.5 text-[13px] text-[#64748B]">
            {tenant?.name ? `${tenant.name} · ` : ''}Vas a trabajar con los datos de la sucursal que elijas.
          </p>
        </div>

        <div
          className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        >
          <div className="h-1 bg-[#1E3A5F]" />
          <div className="p-4 space-y-2">
            {availableTiendas.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                disabled={!!busyId}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#E2E8F0]
                  text-left hover:border-[#3B82F6] hover:bg-[#F0F4F8] transition-all
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="w-9 h-9 rounded-lg bg-[#EFF6FF] flex items-center justify-center shrink-0">
                  <Store size={17} className="text-[#3B82F6]" />
                </span>
                <span className="text-[14px] font-medium text-[#0F172A]">{t.name}</span>
                {busyId === t.id && (
                  <span className="ml-auto text-[12px] text-[#64748B]">Entrando…</span>
                )}
              </button>
            ))}

            {availableTiendas.length === 0 && (
              <p className="text-[13px] text-[#64748B] text-center py-6">
                No hay sucursales disponibles para tu usuario.
              </p>
            )}

            {error && <p className="text-[13px] text-red-500 pt-1 px-1">{error}</p>}
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="mt-5 w-full text-center text-[12px] text-[#64748B] hover:text-[#475569] transition-colors"
        >
          Cerrar sesión
        </button>
      </div>

      <SyntraFooter variant="fixed" />
    </div>
  );
};

export default SelectBranch;

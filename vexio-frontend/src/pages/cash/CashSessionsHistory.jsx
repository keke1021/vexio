import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import CashSessionsTable from './CashSessionsTable';

// Historial de CashSession de la SUCURSAL ACTIVA (abiertas y cerradas).
// Puramente de lectura. La tabla vive en CashSessionsTable.jsx (compartida con
// el historial embebido de CashMain.jsx); acá solo el layout de página.
const CashSessionsHistory = () => {
  const { activeTienda } = useAuth();

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/cash" className="text-[#475569] hover:text-[#64748B] transition-colors text-[13px]">← Caja</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Historial de cajas</span>
      </div>

      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Historial de cajas</h1>
        {activeTienda && (
          <p className="text-[13px] text-[#475569] mt-0.5">Sucursal: {activeTienda.name}</p>
        )}
      </div>

      <CashSessionsTable />
    </div>
  );
};

export default CashSessionsHistory;

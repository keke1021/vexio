import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';
import CashSessionsTable from './CashSessionsTable';

// Historial de CashSession — a diferencia de CashMain.jsx (que solo ve "la
// sesión actual" de una sucursal puntual), esta pantalla consulta todas las
// sesiones pasadas de todas las sucursales (o filtradas a una), abiertas y
// cerradas. Puramente de lectura — no toca /cash/open ni /cash/close.
// La tabla en sí vive en CashSessionsTable.jsx (compartida con CashMain.jsx,
// que la embebe directo en la pantalla de Caja) — acá solo el layout de
// página: breadcrumb, título y selector de sucursal.
const CashSessionsHistory = () => {
  const [tiendaId, setTiendaId] = useState('');

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-center gap-3 mb-6">
        <Link to="/cash" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Caja</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Historial de cajas</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Historial de cajas</h1>
        {tiendas.length > 1 && (
          <div>
            <label className="text-[10px] text-[#94A3B8] uppercase tracking-[0.12em] mr-2">Sucursal</label>
            <select
              value={tiendaId}
              onChange={(e) => setTiendaId(e.target.value)}
              className="bg-white border border-[#E2E8F0] rounded-lg px-2 py-1 text-[13px] text-[#0F172A]
                focus:outline-none focus:border-[#3B82F6] transition-all"
            >
              <option value="">Todas las sucursales</option>
              {tiendas.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <CashSessionsTable tiendaId={tiendaId} showTiendaColumn={tiendas.length > 1} />
    </div>
  );
};

export default CashSessionsHistory;

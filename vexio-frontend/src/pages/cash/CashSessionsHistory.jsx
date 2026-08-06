import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';

const PAGE_SIZE = 20;
const CURRENCIES = ['ARS', 'USD', 'USDT'];

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtGeneric = (n, code) =>
  `${code} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

const fmtByCurrency = (n, code) => (code === 'ARS' ? fmt(n) : fmtGeneric(n, code));

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

// Historial de CashSession — a diferencia de CashMain.jsx (que solo ve "la
// sesión actual" de una sucursal puntual), esta pantalla consulta todas las
// sesiones pasadas de todas las sucursales (o filtradas a una), abiertas y
// cerradas. Puramente de lectura — no toca /cash/open ni /cash/close.
const CashSessionsHistory = () => {
  const [page, setPage] = useState(1);
  const [tiendaId, setTiendaId] = useState('');

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cash-sessions', tiendaId, page],
    queryFn: () =>
      api.get('/cash/sessions', { params: { tiendaId: tiendaId || undefined, page, pageSize: PAGE_SIZE } })
        .then((r) => r.data),
    staleTime: 30_000,
  });

  const sessions = data?.sessions ?? [];
  const totalPages = data?.totalPages ?? 1;

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
              onChange={(e) => { setTiendaId(e.target.value); setPage(1); }}
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

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Apertura</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Cierre</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Sucursal</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Abrió</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Cerró</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Balance final</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-16 text-[#CBD5E1] text-[13px]">Cargando...</td></tr>
            )}
            {isError && (
              <tr><td colSpan={6} className="text-center py-16 text-red-400 text-[13px]">Error al cargar el historial.</td></tr>
            )}
            {!isLoading && !isError && sessions.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-[#CBD5E1] text-[13px]">Todavía no hay ninguna sesión de caja.</td></tr>
            )}
            {sessions.map((s) => {
              const activeCurrencies = CURRENCIES.filter((c) => s.byCurrency?.[c]);
              return (
                <tr key={s.id} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3.5 text-[#64748B]">
                    <Link to={`/cash/sessions/${s.id}`} className="hover:text-[#3B82F6] transition-colors">
                      {fmtDateTime(s.openedAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    {s.isOpen ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 text-[11px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Abierta
                      </span>
                    ) : (
                      <span className="text-[#64748B]">{fmtDateTime(s.closedAt)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-[#94A3B8] hidden sm:table-cell">{s.tienda?.name ?? '—'}</td>
                  <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">{s.openedBy?.name ?? '—'}</td>
                  <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">{s.closedBy?.name ?? '—'}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums">
                    {activeCurrencies.length === 0 && <span className="text-[#CBD5E1]">—</span>}
                    {activeCurrencies.map((cur) => (
                      <p key={cur} className={`font-medium ${s.byCurrency[cur].balance >= 0 ? 'text-[#0F172A]' : 'text-red-500'}`}>
                        {fmtByCurrency(s.byCurrency[cur].balance, cur)}
                      </p>
                    ))}
                    {s.adjustments?.length > 0 && (
                      <p className="text-[11px] text-amber-600 mt-0.5">
                        {s.adjustments.length} ajuste{s.adjustments.length !== 1 ? 's' : ''} de cierre
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-[12px] text-[#94A3B8]">Página {page} de {totalPages}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]
                text-[13px] font-medium px-3 py-1.5 rounded-lg transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              className="border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]
                text-[13px] font-medium px-3 py-1.5 rounded-lg transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CashSessionsHistory;

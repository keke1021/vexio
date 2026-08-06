import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';

const CURRENCIES = ['ARS', 'USD', 'USDT'];

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtGeneric = (n, code) =>
  `${code} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

const fmtByCurrency = (n, code) => (code === 'ARS' ? fmt(n) : fmtGeneric(n, code));

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Tabla + paginación del historial de CashSession — extraída de
 * CashSessionsHistory.jsx para poder reusarla también embebida en
 * CashMain.jsx (misma consulta a GET /cash/sessions, mismo shape de fila).
 * No decide layout de página (breadcrumb, título, selector de sucursal) —
 * eso lo resuelve cada caller; acá solo vive la tabla en sí.
 *
 * `tiendaId` opcional: si viene, filtra a esa sucursal (mismo query param
 * que ya acepta el backend). `showTiendaColumn` en false oculta la columna
 * "Sucursal" — tiene sentido apagarla cuando el caller ya está scopeado a
 * una sola sucursal (ej. CashMain), para no repetir el mismo nombre en cada fila.
 */
const CashSessionsTable = ({ tiendaId, showTiendaColumn = true, pageSize = 20 }) => {
  const [page, setPage] = useState(1);

  // Volver a la página 1 cuando cambia el filtro de sucursal — mismo
  // comportamiento que tenía el onChange del selector en CashSessionsHistory.
  useEffect(() => {
    setPage(1);
  }, [tiendaId]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cash-sessions', tiendaId ?? '', page, pageSize],
    queryFn: () =>
      api.get('/cash/sessions', { params: { tiendaId: tiendaId || undefined, page, pageSize } })
        .then((r) => r.data),
    staleTime: 30_000,
  });

  const sessions = data?.sessions ?? [];
  const totalPages = data?.totalPages ?? 1;
  const colSpan = showTiendaColumn ? 6 : 5;

  return (
    <div>
      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Apertura</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Cierre</th>
              {showTiendaColumn && (
                <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Sucursal</th>
              )}
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Abrió</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Cerró</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Balance final</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={colSpan} className="text-center py-16 text-[#CBD5E1] text-[13px]">Cargando...</td></tr>
            )}
            {isError && (
              <tr><td colSpan={colSpan} className="text-center py-16 text-red-400 text-[13px]">Error al cargar el historial.</td></tr>
            )}
            {!isLoading && !isError && sessions.length === 0 && (
              <tr><td colSpan={colSpan} className="text-center py-16 text-[#CBD5E1] text-[13px]">Todavía no hay ninguna sesión de caja.</td></tr>
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
                  {showTiendaColumn && (
                    <td className="px-4 py-3.5 text-[#94A3B8] hidden sm:table-cell">{s.tienda?.name ?? '—'}</td>
                  )}
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

export default CashSessionsTable;

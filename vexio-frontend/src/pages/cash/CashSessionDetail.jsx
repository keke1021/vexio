import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';

const PAYMENT_LABELS = {
  CASH:         'Efectivo',
  TRANSFER:     'Transferencia',
  CARD:         'Tarjeta',
  INSTALLMENTS: 'Cuotas',
};

const CURRENCIES = ['ARS', 'USD', 'USDT'];

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtGeneric = (n, code) =>
  `${code} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

const fmtByCurrency = (n, code) => (code === 'ARS' ? fmt(n) : fmtGeneric(n, code));

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const CURRENCY_BADGE_CLS = {
  ARS:  'bg-[#F1F5F9] text-[#64748B]',
  USD:  'bg-[#DCFCE7] text-[#16A34A]',
  USDT: 'bg-[#DBEAFE] text-[#2563EB]',
};

const StatCard = ({ label, value, accent }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-2">{label}</p>
    <p className={`text-[22px] font-semibold tracking-tight ${accent ?? 'text-[#0F172A]'}`}>{value}</p>
  </div>
);

// Auditoría de una sesión de caja puntual (cualquier id, abierta o cerrada)
// — mismo shape de movimientos que CashMain.jsx muestra para "la sesión
// actual", pero acá sobre un id explícito de una sesión pasada. Puramente
// de lectura.
const CashSessionDetail = () => {
  const { id } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cash-session', id],
    queryFn: () => api.get(`/cash/sessions/${id}`).then((r) => r.data),
  });

  if (isLoading) {
    return <div className="px-6 pt-8 text-[#CBD5E1] text-[13px]">Cargando...</div>;
  }
  if (isError || !data) {
    return (
      <div className="px-6 pt-8">
        <p className="text-[#94A3B8] text-[13px]">Sesión de caja no encontrada.</p>
        <Link to="/cash/sessions" className="text-[#3B82F6] text-[13px] mt-2 inline-block">← Volver al historial</Link>
      </div>
    );
  }

  const { session, movements = [], byCurrency = {}, adjustments = [] } = data;
  const activeCurrencies = CURRENCIES.filter((cur) => byCurrency[cur]);

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-center gap-3 mb-6">
        <Link to="/cash/sessions" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Historial de cajas</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">{session.tienda?.name ?? 'Sesión'}</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">
            {session.tienda?.name ?? 'Sesión de caja'}
          </h1>
          <p className="text-[13px] text-[#94A3B8] mt-0.5">
            Abierta {fmtDateTime(session.openedAt)} · {session.openedBy?.name ?? '—'}
            {!session.isOpen && (
              <> · Cerrada {fmtDateTime(session.closedAt)} · {session.closedBy?.name ?? '—'}</>
            )}
          </p>
          {session.notes && (
            <p className="text-[12px] text-[#94A3B8] mt-1">Nota: {session.notes}</p>
          )}
        </div>
        {session.isOpen ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 text-[11px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Abierta
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#F1F5F9] text-[#94A3B8] border border-[#E2E8F0] text-[11px] font-medium">
            Cerrada
          </span>
        )}
      </div>

      {activeCurrencies.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {activeCurrencies.map((cur) => {
            const b = byCurrency[cur];
            return (
              <div key={cur} className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-3">Balance {cur}</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#94A3B8]">Monto inicial</span>
                    <span className="text-[#64748B]">{fmtByCurrency(b.openingBalance, cur)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#94A3B8]">Ingresos</span>
                    <span className="text-emerald-600 font-medium">{fmtByCurrency(b.income, cur)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#94A3B8]">Egresos</span>
                    <span className="text-red-500 font-medium">{fmtByCurrency(b.expense, cur)}</span>
                  </div>
                  {b.adjustments !== 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-[#94A3B8]">Ajuste de cierre</span>
                      <span className={`font-medium ${b.adjustments >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {fmtByCurrency(b.adjustments, cur)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-[#E2E8F0] pt-1.5 flex justify-between text-[13px]">
                    <span className="text-[#64748B] font-medium">Balance final</span>
                    <span className={`font-bold ${b.balance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmtByCurrency(b.balance, cur)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adjustments.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6">
          <p className="text-[10px] font-medium text-amber-600 uppercase tracking-[0.15em] mb-2">Ajustes de cierre</p>
          <div className="space-y-1">
            {adjustments.map((a, idx) => (
              <p key={idx} className="text-[12px] text-amber-700">
                {a.description ?? `Ajuste ${fmtByCurrency(a.amount, a.currencyCode)}`}
              </p>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-3">Movimientos</p>

        <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {movements.length === 0 && (
            <p className="text-center py-10 text-[#CBD5E1] text-[13px]">Sin movimientos en esta sesión.</p>
          )}
          {movements.length > 0 && (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Tipo</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Descripción</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Medio</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Monto</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Moneda</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Hora</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Usuario</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-[#E2E8F0]">
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                        m.type === 'INCOME' ? 'text-emerald-600' : 'text-red-500'
                      }`}>
                        <span>{m.type === 'INCOME' ? '+' : '−'}</span>
                        <span>{m.type === 'INCOME' ? 'Ingreso' : 'Egreso'}</span>
                        {m.sale && <span className="text-[#CBD5E1] font-normal">venta</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-[#64748B]">{m.description}</td>
                    <td className="px-4 py-3.5 text-[#94A3B8] hidden sm:table-cell">
                      {PAYMENT_LABELS[m.paymentMethod] ?? m.paymentMethod}
                    </td>
                    <td className={`px-4 py-3.5 text-right font-medium tabular-nums ${
                      m.type === 'INCOME' ? 'text-emerald-600' : 'text-red-500'
                    }`}>
                      {m.type === 'INCOME' ? '+' : '−'}{fmtByCurrency(m.amount, m.currencyCode ?? 'ARS')}
                    </td>
                    <td className="px-4 py-3.5">
                      {(() => {
                        const cur = m.currencyCode ?? 'ARS';
                        return (
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${CURRENCY_BADGE_CLS[cur] ?? CURRENCY_BADGE_CLS.ARS}`}>
                            {cur}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">{fmtDateTime(m.createdAt)}</td>
                    <td className="px-4 py-3.5 text-[#94A3B8] hidden lg:table-cell">{m.createdBy?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default CashSessionDetail;

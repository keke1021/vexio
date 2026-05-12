import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';

const PAYMENT_LABELS = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  INSTALLMENTS: 'Cuotas',
};

const PAYMENT_COLORS = {
  CASH: 'text-emerald-600',
  TRANSFER: 'text-[#3B82F6]',
  CARD: 'text-purple-600',
  INSTALLMENTS: 'text-orange-500',
};

const formatCurrency = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const formatTime = (d) =>
  new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

const formatDate = (d) =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const todayStr = () => new Date().toISOString().split('T')[0];

const SummaryCard = ({ label, value, sub }) => (
  <div className="border border-[#E2E8F0] rounded-xl p-4 bg-white"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <p className="text-[11px] text-[#94A3B8] uppercase tracking-wider">{label}</p>
    <p className="text-[22px] font-semibold mt-1 text-[#0F172A]">{value}</p>
    {sub && <p className="text-[11px] text-[#94A3B8] mt-0.5">{sub}</p>}
  </div>
);

const PosSales = () => {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [paymentFilter, setPaymentFilter] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pos-sales', dateFrom, dateTo, paymentFilter],
    queryFn: () =>
      api.get('/pos/sales', {
        params: {
          from: dateFrom || undefined,
          to: dateTo || undefined,
          paymentMethod: paymentFilter || undefined,
        },
      }).then((r) => r.data),
    staleTime: 30_000,
  });

  const sales = data?.sales ?? [];
  const summary = data?.summary ?? {};

  const isToday = dateFrom === todayStr() && dateTo === todayStr();

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">
            Historial de ventas {isToday && <span className="text-[#3B82F6] text-[16px] font-normal ml-2">— Hoy</span>}
          </h1>
          <p className="text-[13px] text-[#94A3B8] mt-0.5">
            {isLoading ? '...' : `${summary.salesCount ?? 0} venta${summary.salesCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link
          to="/pos"
          className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nueva venta
        </Link>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#94A3B8]">Desde</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
              focus:outline-none focus:border-[#3B82F6] transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#94A3B8]">Hasta</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
              focus:outline-none focus:border-[#3B82F6] transition-colors"
          />
        </div>
        <button
          onClick={() => { setDateFrom(todayStr()); setDateTo(todayStr()); }}
          className="text-[12px] text-[#3B82F6] hover:text-[#2563EB] transition-colors"
        >
          Hoy
        </button>
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
            focus:outline-none focus:border-[#3B82F6] transition-colors"
        >
          <option value="">Todos los pagos</option>
          {Object.entries(PAYMENT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {!isLoading && summary.salesCount > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <SummaryCard label="Total" value={formatCurrency(summary.totalAmount)} sub={`${summary.salesCount} ventas`} />
          {Object.entries(summary.byPaymentMethod ?? {}).map(([pm, data]) => (
            <SummaryCard
              key={pm}
              label={PAYMENT_LABELS[pm]}
              value={formatCurrency(data.total)}
              sub={`${data.count} venta${data.count !== 1 ? 's' : ''}`}
            />
          ))}
        </div>
      )}

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Hora</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Vendedor</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Pago</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Cliente</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Items</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-16 text-[#CBD5E1] text-[13px]">Cargando...</td></tr>
            )}
            {isError && (
              <tr><td colSpan={6} className="text-center py-16 text-red-400 text-[13px]">Error al cargar las ventas.</td></tr>
            )}
            {!isLoading && !isError && sales.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-16 text-[#CBD5E1] text-[13px]">
                  No hay ventas en el período seleccionado.
                </td>
              </tr>
            )}
            {sales.map((sale) => (
              <tr
                key={sale.id}
                onClick={() => navigate(`/pos/sales/${sale.id}`)}
                className="border-b border-[#E2E8F0] hover:bg-[#EFF6FF] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3.5">
                  <p className="text-[#64748B] font-mono text-[12px]">{formatTime(sale.createdAt)}</p>
                  {dateFrom !== dateTo && (
                    <p className="text-[#94A3B8] text-[11px]">{formatDate(sale.createdAt)}</p>
                  )}
                </td>
                <td className="px-4 py-3.5 text-[#64748B] hidden sm:table-cell">{sale.seller?.name}</td>
                <td className="px-4 py-3.5">
                  <span className={`text-[12px] font-medium ${PAYMENT_COLORS[sale.paymentMethod]}`}>
                    {PAYMENT_LABELS[sale.paymentMethod]}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">
                  {sale.customerName ?? '—'}
                </td>
                <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">
                  {sale._count?.items ?? 0}
                </td>
                <td className="px-4 py-3.5 text-right font-medium text-[#0F172A]">
                  {formatCurrency(sale.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PosSales;

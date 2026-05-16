import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import * as XLSX from 'xlsx';
import api from '../../api/axios';

// ─── Config ───────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  CASH: 'Efectivo', TRANSFER: 'Transferencia', CARD: 'Tarjeta', INSTALLMENTS: 'Cuotas',
};

const CONDITION_LABELS = {
  NEW: 'Nuevo', LIKE_NEW: 'Como nuevo', REFURBISHED: 'Reacondicionado', USED: 'Usado',
};

const REPAIR_LABELS = {
  RECEIVED: 'Recibidos', DIAGNOSING: 'Diagnóstico', IN_PROGRESS: 'En reparación',
  WAITING_PARTS: 'Esperando', READY: 'Listos', DELIVERED: 'Entregados', CANCELLED: 'Cancelados',
};

const PERIODS = [
  { id: 'today', label: 'Hoy' },
  { id: 'week',  label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Personalizado' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtUSD = (n) =>
  `USD ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n ?? 0)}`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';

const getPeriodDates = (period) => {
  const today = new Date();
  const toStr = today.toISOString().split('T')[0];
  if (period === 'today') return { from: toStr, to: toStr };
  if (period === 'week') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { from: start.toISOString().split('T')[0], to: toStr };
  }
  if (period === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: first.toISOString().split('T')[0], to: toStr };
  }
  return null;
};

const fillDailyData = (data, from, to) => {
  if (!data?.length || !from) return data ?? [];
  const map = Object.fromEntries(data.map((d) => [d.date, d]));
  const result = [];
  const cur = new Date(from);
  const end = new Date(to ?? from);
  while (cur <= end) {
    const k = cur.toISOString().split('T')[0];
    result.push(map[k] ?? { date: k, total: 0, count: 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
};

// ─── Chart tooltip ────────────────────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[12px] shadow-lg">
      <p className="text-[#64748B] mb-1">{fmtDate(label)}</p>
      <p className="text-[#0F172A] font-medium">{fmt(payload[0]?.value)}</p>
      {payload[0]?.payload?.count > 0 && (
        <p className="text-[#94A3B8] mt-0.5">{payload[0].payload.count} venta{payload[0].payload.count !== 1 ? 's' : ''}</p>
      )}
    </div>
  );
};

// ─── Shared atoms ─────────────────────────────────────────────────────────────

const SectionTitle = ({ children }) => (
  <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">{children}</p>
);

const StatCard = ({ label, value, sub, accent }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
    <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-2">{label}</p>
    <p className={`text-[22px] font-semibold tracking-tight ${accent ?? 'text-[#0F172A]'}`}>{value}</p>
    {sub && <p className="text-[11px] text-[#CBD5E1] mt-1">{sub}</p>}
  </div>
);

const LoadingRow = () => (
  <p className="text-[13px] text-[#CBD5E1] py-6">Cargando...</p>
);

// ─── Excel Export ─────────────────────────────────────────────────────────────

const exportToExcel = ({ salesData, productsData, inventoryData, repairsData, cashData, periodLabel }) => {
  const wb = XLSX.utils.book_new();

  const salesRows = [
    ['Período', periodLabel],
    [],
    ['Total ventas', salesData?.total ?? 0],
    ['Cantidad de ventas', salesData?.count ?? 0],
    ['Ticket promedio', salesData?.avgTicket ?? 0],
    [],
    ['Medio de pago', 'Total', 'Cantidad'],
    ...Object.entries(salesData?.byPaymentMethod ?? {}).map(([pm, v]) => [
      PAYMENT_LABELS[pm] ?? pm, v.total, v.count,
    ]),
    [],
    ['Fecha', 'Total del día', 'Cantidad'],
    ...(salesData?.dailyData ?? []).map((d) => [d.date, d.total, d.count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salesRows), 'Ventas');

  const prodRows = [
    ['Producto', 'Unidades vendidas', 'Ingreso total', 'Precio promedio', 'Margen %'],
    ...(productsData?.topProducts ?? []).map((p) => [
      p.name, p.soldCount, p.revenue, p.avgSalePrice, p.avgMargin,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prodRows), 'Productos');

  const invByCur = inventoryData?.byCurrency ?? {};
  const invRows = [
    ['Total equipos disponibles', inventoryData?.totalItems ?? 0],
    [],
    ['Moneda', 'Valor de costo', 'Valor de venta', 'Equipos'],
    ...['ARS', 'USD', 'USDT'].filter((c) => invByCur[c]).map((c) => [
      c, invByCur[c].costValue, invByCur[c].saleValue, invByCur[c].count,
    ]),
    [],
    ['Condición', 'Cantidad', 'Valor costo'],
    ...(inventoryData?.byCondition ?? []).map((c) => [
      CONDITION_LABELS[c.condition] ?? c.condition, c.count, c.costValue,
    ]),
    [],
    ['Stock bajo — Producto', 'Disponible', 'Mínimo'],
    ...(inventoryData?.alerts ?? []).map((a) => [a.product, a.available, a.minStock]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invRows), 'Inventario');

  const repairRows = [
    ['Entregadas en período', repairsData?.completedCount ?? 0],
    ['Facturación estimada', repairsData?.totalBilling ?? 0],
    ['Tiempo promedio (días)', repairsData?.avgRepairDays ?? '—'],
    [],
    ['Estado', 'Cantidad', 'Presupuesto total'],
    ...Object.entries(repairsData?.byStatus ?? {}).map(([status, v]) => [
      REPAIR_LABELS[status] ?? status, v.count, v.total,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(repairRows), 'Reparaciones');

  const cashRows = [
    ['Ingresos', cashData?.income ?? 0],
    ['Egresos', cashData?.expense ?? 0],
    ['Saldo neto', cashData?.netBalance ?? 0],
    [],
    ['Medio de pago', 'Ingresos', 'Egresos'],
    ...Object.entries(cashData?.byPaymentMethod ?? {}).map(([pm, v]) => [
      PAYMENT_LABELS[pm] ?? pm, v.income, v.expense,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cashRows), 'Caja');

  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `reporte-vexio-${today}.xlsx`);
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const ReportsPage = () => {
  const [period, setPeriod]         = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');

  const dates = useMemo(() => {
    if (period === 'custom') {
      return customFrom && customTo ? { from: customFrom, to: customTo } : null;
    }
    return getPeriodDates(period);
  }, [period, customFrom, customTo]);

  const periodLabel = useMemo(() => {
    if (!dates) return '—';
    const p = PERIODS.find((p) => p.id === period);
    return p?.id === 'custom'
      ? `${dates.from} al ${dates.to}`
      : `${p?.label} (${dates.from} al ${dates.to})`;
  }, [dates, period]);

  const qOpts = (key) => ({
    queryKey: [key, dates],
    queryFn:  () => api.get(`/reports/${key}`, { params: dates ?? {} }).then((r) => r.data),
    enabled:  !!dates,
    staleTime: 2 * 60_000,
  });

  const salesQ     = useQuery(qOpts('sales'));
  const productsQ  = useQuery(qOpts('products'));
  const inventoryQ = useQuery({
    queryKey: ['reports-inventory'],
    queryFn:  () => api.get('/reports/inventory').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const repairsQ   = useQuery(qOpts('repairs'));
  const cashQ      = useQuery(qOpts('cash'));

  const dailyData = useMemo(
    () => fillDailyData(salesQ.data?.dailyData, dates?.from, dates?.to),
    [salesQ.data, dates]
  );

  const handleExport = () => {
    exportToExcel({
      salesData:     salesQ.data,
      productsData:  productsQ.data,
      inventoryData: inventoryQ.data,
      repairsData:   repairsQ.data,
      cashData:      cashQ.data,
      periodLabel,
    });
  };

  const anyLoading = salesQ.isLoading || productsQ.isLoading || repairsQ.isLoading || cashQ.isLoading;

  return (
    <div className="px-6 pt-8 pb-16 max-w-[1100px] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Reportes</h1>
        <button
          onClick={handleExport}
          disabled={anyLoading || !dates}
          className="bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]
            text-[12px] font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-30"
        >
          Exportar Excel
        </button>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 mb-8">
        <div className="flex items-center gap-1 bg-white border border-[#E2E8F0] rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                period === p.id
                  ? 'bg-[#3B82F6] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[12px] text-[#0F172A]
                focus:outline-none focus:border-[#3B82F6] transition-all"
            />
            <span className="text-[#CBD5E1] text-[12px]">al</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[12px] text-[#0F172A]
                focus:outline-none focus:border-[#3B82F6] transition-all"
            />
          </div>
        )}
        {dates && (
          <span className="text-[11px] text-[#CBD5E1] ml-1">{periodLabel}</span>
        )}
      </div>

      {!dates && (
        <p className="text-[#94A3B8] text-[13px] mb-8">Seleccioná un período personalizado para ver los datos.</p>
      )}

      {/* ── Ventas ──────────────────────────────────────────────────────────── */}
      <section className="mb-10">
        <SectionTitle>Ventas</SectionTitle>

        {salesQ.isLoading && <LoadingRow />}
        {!salesQ.isLoading && salesQ.data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
              <StatCard label="Total del período"  value={fmt(salesQ.data.total)} accent="text-[#3B82F6]" />
              <StatCard label="Cantidad de ventas" value={salesQ.data.count} />
              <StatCard label="Ticket promedio"    value={fmt(salesQ.data.avgTicket)} />
            </div>

            {dailyData.length > 1 && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 mb-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-4">
                  Ventas por día
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="rgba(0,0,0,0.06)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtDate}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar dataKey="total" fill="#3B82F6" radius={[3, 3, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {Object.keys(salesQ.data.byPaymentMethod).length > 0 && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-3">
                  Por medio de pago
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {Object.entries(salesQ.data.byPaymentMethod).map(([pm, v]) => (
                    <div key={pm}>
                      <p className="text-[11px] text-[#94A3B8] mb-1">{PAYMENT_LABELS[pm] ?? pm}</p>
                      <p className="text-[16px] font-bold text-[#0F172A]">{fmt(v.total)}</p>
                      <p className="text-[11px] text-[#CBD5E1]">{v.count} venta{v.count !== 1 ? 's' : ''}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {salesQ.data.byCurrency && Object.keys(salesQ.data.byCurrency).length > 1 && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 mt-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-3">Por moneda</p>
                <div className="flex flex-wrap gap-5">
                  {['ARS', 'USD', 'USDT'].map((cur) => {
                    const v = salesQ.data.byCurrency[cur];
                    if (!v) return null;
                    return (
                      <div key={cur}>
                        <p className="text-[11px] font-bold text-[#94A3B8] mb-1">{cur}</p>
                        <p className="text-[16px] font-bold text-[#0F172A]">{fmt(v.total)}</p>
                        <p className="text-[11px] text-[#CBD5E1]">{v.count} venta{v.count !== 1 ? 's' : ''}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {salesQ.data.count === 0 && (
              <p className="text-[13px] text-[#CBD5E1]">Sin ventas en el período seleccionado.</p>
            )}
          </>
        )}
      </section>

      {/* ── Productos ────────────────────────────────────────────────────────── */}
      <section className="mb-10">
        <SectionTitle>Productos más vendidos</SectionTitle>

        {productsQ.isLoading && <LoadingRow />}
        {!productsQ.isLoading && productsQ.data && (
          <>
            {productsQ.data.topProducts.length === 0 ? (
              <p className="text-[13px] text-[#CBD5E1]">Sin datos de ventas en el período.</p>
            ) : (
              <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-[#64748B] uppercase tracking-wider">#</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-[#64748B] uppercase tracking-wider">Producto</th>
                      <th className="text-right px-4 py-3 text-[11px] font-medium text-[#64748B] uppercase tracking-wider">Uds.</th>
                      <th className="text-right px-4 py-3 text-[11px] font-medium text-[#64748B] uppercase tracking-wider hidden sm:table-cell">Ingreso</th>
                      <th className="text-right px-4 py-3 text-[11px] font-medium text-[#64748B] uppercase tracking-wider hidden md:table-cell">Precio prom.</th>
                      <th className="text-right px-4 py-3 text-[11px] font-medium text-[#64748B] uppercase tracking-wider">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsQ.data.topProducts.map((p, idx) => (
                      <tr key={p.productId} className="border-b border-[#E2E8F0] hover:bg-[#EFF6FF]">
                        <td className="px-4 py-3 text-[#CBD5E1] text-[11px] font-mono">{idx + 1}</td>
                        <td className="px-4 py-3 text-[#374151]">{p.name}</td>
                        <td className="px-4 py-3 text-right text-[#0F172A] font-medium">{p.soldCount}</td>
                        <td className="px-4 py-3 text-right text-[#64748B] hidden sm:table-cell">{fmt(p.revenue)}</td>
                        <td className="px-4 py-3 text-right text-[#64748B] hidden md:table-cell">{fmt(p.avgSalePrice)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-[12px] font-medium ${p.avgMargin >= 20 ? 'text-emerald-600' : p.avgMargin >= 10 ? 'text-[#64748B]' : 'text-orange-500'}`}>
                            {p.avgMargin}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Inventario ───────────────────────────────────────────────────────── */}
      <section className="mb-10">
        <SectionTitle>Inventario (estado actual)</SectionTitle>

        {inventoryQ.isLoading && <LoadingRow />}
        {!inventoryQ.isLoading && inventoryQ.data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              <StatCard label="Equipos disponibles" value={inventoryQ.data.totalItems} />

              <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-3">Valor de costo</p>
                {['ARS', 'USD', 'USDT'].map((cur) => {
                  const v = inventoryQ.data.byCurrency?.[cur];
                  if (!v) return null;
                  return (
                    <div key={cur} className="mb-2 last:mb-0">
                      <p className="text-[10px] text-[#CBD5E1] mb-0.5">{cur}</p>
                      <p className="text-[18px] font-semibold tracking-tight text-[#0F172A]">
                        {cur === 'ARS' ? fmt(v.costValue) : fmtUSD(v.costValue)}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-3">Valor de venta</p>
                {['ARS', 'USD', 'USDT'].map((cur) => {
                  const v = inventoryQ.data.byCurrency?.[cur];
                  if (!v) return null;
                  return (
                    <div key={cur} className="mb-2 last:mb-0">
                      <p className="text-[10px] text-[#CBD5E1] mb-0.5">{cur}</p>
                      <p className="text-[18px] font-semibold tracking-tight text-[#3B82F6]">
                        {cur === 'ARS' ? fmt(v.saleValue) : fmtUSD(v.saleValue)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {inventoryQ.data.byCondition.length > 0 && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 mb-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-3">Por condición</p>
                <div className="flex flex-wrap gap-5">
                  {inventoryQ.data.byCondition.map((c) => (
                    <div key={c.condition}>
                      <p className="text-[11px] text-[#94A3B8] mb-0.5">{CONDITION_LABELS[c.condition] ?? c.condition}</p>
                      <p className="text-[16px] font-bold text-[#0F172A]">{c.count}</p>
                      <p className="text-[11px] text-[#CBD5E1]">{fmt(c.costValue)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inventoryQ.data.alerts.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4">
                <p className="text-[10px] font-medium text-orange-500 uppercase tracking-[0.12em] mb-3">
                  Stock bajo ({inventoryQ.data.alerts.length})
                </p>
                <div className="space-y-1.5">
                  {inventoryQ.data.alerts.map((a) => (
                    <div key={a.product} className="flex items-center justify-between text-[12px]">
                      <span className="text-[#64748B]">{a.product}</span>
                      <span className={`font-medium ${a.available === 0 ? 'text-red-500' : 'text-orange-500'}`}>
                        {a.available} / {a.minStock} mín
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Reparaciones ─────────────────────────────────────────────────────── */}
      <section className="mb-10">
        <SectionTitle>Reparaciones</SectionTitle>

        {repairsQ.isLoading && <LoadingRow />}
        {!repairsQ.isLoading && repairsQ.data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
              <StatCard label="Entregadas en período" value={repairsQ.data.completedCount} />
              <StatCard label="Facturación estimada"  value={fmt(repairsQ.data.totalBilling)} accent="text-[#3B82F6]" />
              <StatCard
                label="Tiempo promedio"
                value={repairsQ.data.avgRepairDays != null ? `${repairsQ.data.avgRepairDays}d` : '—'}
                sub="días desde ingreso a entrega"
              />
            </div>

            {Object.keys(repairsQ.data.byStatus).length > 0 && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-3">Por estado</p>
                <div className="flex flex-wrap gap-5">
                  {Object.entries(repairsQ.data.byStatus).map(([status, v]) => (
                    <div key={status}>
                      <p className="text-[11px] text-[#94A3B8] mb-0.5">{REPAIR_LABELS[status] ?? status}</p>
                      <p className="text-[16px] font-bold text-[#0F172A]">{v.count}</p>
                      {v.total > 0 && <p className="text-[11px] text-[#CBD5E1]">{fmt(v.total)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Caja ─────────────────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Caja</SectionTitle>

        {cashQ.isLoading && <LoadingRow />}
        {!cashQ.isLoading && cashQ.data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
              <StatCard label="Ingresos"   value={fmt(cashQ.data.income)}     accent="text-emerald-600" />
              <StatCard label="Egresos"    value={fmt(cashQ.data.expense)}    accent="text-red-500" />
              <StatCard label="Saldo neto" value={fmt(cashQ.data.netBalance)} accent={cashQ.data.netBalance >= 0 ? 'text-[#0F172A]' : 'text-red-500'} />
            </div>

            {Object.keys(cashQ.data.byPaymentMethod).length > 0 && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-3">Por medio de pago</p>
                <div className="flex flex-wrap gap-5">
                  {Object.entries(cashQ.data.byPaymentMethod).map(([pm, v]) => (
                    <div key={pm}>
                      <p className="text-[11px] text-[#94A3B8] mb-0.5">{PAYMENT_LABELS[pm] ?? pm}</p>
                      <p className="text-[13px] font-medium text-emerald-600">+{fmt(v.income)}</p>
                      {v.expense > 0 && <p className="text-[12px] text-red-500">−{fmt(v.expense)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

    </div>
  );
};

export default ReportsPage;

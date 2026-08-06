import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import CashSessionsTable from './CashSessionsTable';

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

// Formatea un monto según su moneda: ARS usa el formato de pesos, cualquier
// otra moneda (USD, USDT, o lo que venga) usa "CODE 1.234,56" — nunca se
// asume que "no ARS" implica USD (antes USDT quedaba fusionado con USD).
const fmtByCurrency = (n, code) => (code === 'ARS' ? fmt(n) : fmtGeneric(n, code));

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—';

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

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

// Una BalanceCard por moneda — antes USD y USDT se fusionaban en una sola
// tarjeta "USD" sumando sus valores; ahora cada moneda presente en
// byCurrency tiene la suya, incluida USDT.
const BalanceCard = ({ currencyCode, data }) => {
  const { income = 0, expense = 0, balance = 0 } = data ?? {};
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-3">
        Balance {currencyCode}
      </p>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[13px]">
          <span className="text-[#94A3B8]">Ingresos</span>
          <span className="text-emerald-600 font-medium">{fmtByCurrency(income, currencyCode)}</span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-[#94A3B8]">Egresos</span>
          <span className="text-red-500 font-medium">{fmtByCurrency(expense, currencyCode)}</span>
        </div>
        <div className="border-t border-[#E2E8F0] pt-1.5 flex justify-between text-[13px]">
          <span className="text-[#64748B] font-medium">Saldo</span>
          <span className={`font-bold ${balance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {fmtByCurrency(balance, currencyCode)}
          </span>
        </div>
      </div>
    </div>
  );
};

const SaleDetailModal = ({ saleId, onClose }) => {
  const { data: sale, isLoading } = useQuery({
    queryKey: ['pos-sale', saleId],
    queryFn: () => api.get(`/pos/sales/${saleId}`).then((r) => r.data),
    enabled: !!saleId,
    staleTime: 60_000,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium">Detalle de venta</p>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#64748B] text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4">
          {isLoading && (
            <p className="text-center text-[13px] text-[#CBD5E1] py-6">Cargando...</p>
          )}

          {sale && (
            <>
              <div className="space-y-2 mb-4">
                {sale.items?.map((si) => (
                  <div key={si.id} className="border border-[#E2E8F0] rounded-lg px-4 py-3">
                    <p className="text-[13px] font-medium text-[#0F172A]">
                      {[si.inventoryItem?.product?.name, si.inventoryItem?.product?.color, si.inventoryItem?.product?.storage]
                        .filter(Boolean).join(' ')}
                    </p>
                    {si.inventoryItem?.imei && (
                      <p className="text-[11px] text-[#94A3B8] mt-0.5 font-mono">IMEI: {si.inventoryItem.imei}</p>
                    )}
                    <p className="text-[13px] font-semibold mt-1.5 text-[#0F172A]">
                      {fmtByCurrency(si.salePrice, sale.currencyCode)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-2 text-[13px] border-t border-[#E2E8F0] pt-3">
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Total</span>
                  <span className="font-medium text-[#0F172A]">
                    {fmtByCurrency(sale.total, sale.currencyCode)}
                    <span className="text-[#CBD5E1] mx-1">·</span>
                    <span className="text-[#64748B]">{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</span>
                  </span>
                </div>
                {sale.customerName && (
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Cliente</span>
                    <span className="text-[#0F172A]">
                      {sale.customerName}{sale.customerPhone ? ` · ${sale.customerPhone}` : ''}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Vendedor</span>
                  <span className="text-[#0F172A]">{sale.seller?.name ?? '—'}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Resumen compacto de la sesión activa — se muestra centrado, en vez de
// enterrar "quién abrió la caja" en una línea chica bajo el título. Solo
// datos que ya vienen en `session` (openedBy), nada nuevo del backend.
const SessionSummaryCard = ({ session }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-6 py-5 max-w-sm w-full text-center"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 text-[11px] font-medium mb-3">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Caja abierta
    </span>
    <p className="text-[13px] text-[#94A3B8] mb-1">Abierta desde las {fmtTime(session.openedAt)}</p>
    <p className="text-[18px] font-semibold text-[#0F172A] leading-tight">
      {session.openedBy?.name ?? '—'}
    </p>
    <p className="text-[11px] text-[#94A3B8] mt-0.5">abrió esta caja</p>
  </div>
);

const OpenPanel = ({ onOpen, isPending }) => {
  const [amounts, setAmounts] = useState({ ARS: '', USD: '', USDT: '' });
  const [notes, setNotes] = useState('');

  const setAmount = (cur) => (e) => setAmounts((p) => ({ ...p, [cur]: e.target.value }));

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 max-w-sm"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Abrir caja</p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {CURRENCIES.map((cur) => (
          <div key={cur} className="min-w-0">
            <label className="block text-[13px] font-medium text-[#64748B] mb-2">{cur}</label>
            <input
              type="number"
              placeholder="0"
              value={amounts[cur]}
              onChange={setAmount(cur)}
              min="0"
              step={cur === 'ARS' ? '100' : '0.01'}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#0F172A]
                placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
            />
          </div>
        ))}
      </div>
      <div className="mb-5">
        <label className="block text-[13px] font-medium text-[#64748B] mb-2">Nota (opcional)</label>
        <input
          type="text"
          placeholder="Ej: apertura turno mañana"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
            placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
        />
      </div>
      <button
        onClick={() => onOpen({
          initialAmounts: Object.fromEntries(CURRENCIES.map((cur) => [cur, parseFloat(amounts[cur]) || 0])),
          notes: notes || undefined,
        })}
        disabled={isPending}
        className="w-full bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium py-2.5 rounded-lg
          transition-colors disabled:opacity-40"
      >
        {isPending ? 'Abriendo...' : 'Abrir caja'}
      </button>
    </div>
  );
};

const ClosePanel = ({ byCurrency, onClose, isPending, onCancel }) => {
  const [notes, setNotes] = useState('');
  const [counted, setCounted] = useState({});

  const activeCurrencies = CURRENCIES.filter((cur) => byCurrency?.[cur]);

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 max-w-md"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Cerrar caja</p>

      <div className="space-y-4 mb-5">
        {activeCurrencies.length === 0 && (
          <p className="text-[13px] text-[#94A3B8]">Sin movimientos en esta sesión.</p>
        )}
        {activeCurrencies.map((cur) => {
          const b = byCurrency[cur];
          return (
            <div key={cur} className="border border-[#E2E8F0] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-bold text-[#0F172A]">{cur}</span>
                <span className="text-[12px] text-[#64748B]">Calculado: {fmtByCurrency(b.balance, cur)}</span>
              </div>
              <label className="block text-[11px] text-[#94A3B8] mb-1">Monto contado (opcional)</label>
              <input
                type="number"
                placeholder={b.balance.toFixed(2)}
                value={counted[cur] ?? ''}
                onChange={(e) => setCounted((p) => ({ ...p, [cur]: e.target.value }))}
                step="0.01"
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
                  placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
              />
            </div>
          );
        })}
      </div>

      <div className="mb-5">
        <label className="block text-[13px] font-medium text-[#64748B] mb-2">
          Nota (opcional)
        </label>
        <input
          type="text"
          placeholder="Ej: cierre turno tarde"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
            placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onClose({
            notes: notes || undefined,
            countedAmounts: Object.fromEntries(
              Object.entries(counted).filter(([, v]) => v !== '' && v != null)
            ),
          })}
          disabled={isPending}
          className="flex-1 bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 text-[13px] font-medium py-2.5 rounded-lg
            transition-colors disabled:opacity-40"
        >
          {isPending ? 'Cerrando...' : 'Confirmar cierre'}
        </button>
        <button onClick={onCancel} className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  );
};

const CashMain = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = ['OWNER', 'ADMIN'].includes(user?.role);

  const [showClose, setShowClose] = useState(false);
  const [error, setError] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState(null);

  // Cada sucursal tiene su propia caja — tiendaId viaja en la URL para que
  // sea compartible con /cash/movements/new (mismo criterio: auto-preseleccionar
  // si el tenant tiene una sola tienda, mostrar selector si tiene más de una).
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];
  const tiendaIdParam = searchParams.get('tiendaId') || '';
  const tiendaId = tiendaIdParam || (tiendas.length === 1 ? tiendas[0].id : '');

  useEffect(() => {
    if (!tiendaIdParam && tiendas.length === 1) {
      setSearchParams({ tiendaId: tiendas[0].id }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiendas.length, tiendaIdParam]);

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['cash-summary', tiendaId],
    queryFn: () => api.get('/cash/summary', { params: { tiendaId } }).then((r) => r.data),
    enabled: !!tiendaId,
    staleTime: 30_000,
  });

  const { data: movData, isLoading: loadingMov } = useQuery({
    queryKey: ['cash-movements', tiendaId],
    queryFn: () => api.get('/cash/movements', { params: { tiendaId } }).then((r) => r.data),
    enabled: !!tiendaId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
    queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
    // El historial embebido (CashSessionsTable) queda obsoleto igual que el
    // resumen/movimientos al abrir o cerrar caja — antes esto no hacía
    // falta porque el historial vivía en una pantalla aparte que siempre
    // arrancaba con una consulta nueva al entrar.
    queryClient.invalidateQueries({ queryKey: ['cash-sessions'] });
  };

  const openMutation = useMutation({
    mutationFn: (data) => api.post('/cash/open', { ...data, tiendaId }).then((r) => r.data),
    onSuccess: () => { setError(''); invalidate(); },
    onError: (err) => setError(err.response?.data?.message || 'Error al abrir la caja.'),
  });

  const closeMutation = useMutation({
    mutationFn: (data) => api.post('/cash/close', { ...data, tiendaId }).then((r) => r.data),
    onSuccess: () => { setError(''); setShowClose(false); invalidate(); },
    onError: (err) => setError(err.response?.data?.message || 'Error al cerrar la caja.'),
  });

  const isOpen     = summary?.isOpen ?? false;
  const session    = summary?.session;
  const movements  = movData?.movements ?? [];
  const byPayment  = summary?.byPaymentMethod ?? {};
  const byCurrency = summary?.byCurrency ?? {};

  const activeCurrencies = CURRENCIES.filter((cur) => byCurrency[cur]);

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Caja</h1>
          {tiendas.length > 1 && (
            <div className="mt-1.5">
              <label className="text-[10px] text-[#94A3B8] uppercase tracking-[0.12em] mr-2">Sucursal</label>
              <select
                value={tiendaId}
                onChange={(e) => setSearchParams({ tiendaId: e.target.value })}
                className="bg-white border border-[#E2E8F0] rounded-lg px-2 py-1 text-[13px] text-[#0F172A]
                  focus:outline-none focus:border-[#3B82F6] transition-all"
              >
                <option value="">Seleccioná una sucursal</option>
                {tiendas.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          {session && !isOpen && (
            <p className="text-[13px] text-[#94A3B8] mt-0.5">
              {`Cerrada el ${fmtDate(session.closedAt)} a las ${fmtTime(session.closedAt)}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isOpen && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Abierta
            </span>
          )}
          {!isOpen && session && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#F1F5F9] text-[#94A3B8] border border-[#E2E8F0] text-[11px] font-medium">
              Cerrada
            </span>
          )}
          {canManage && isOpen && !showClose && (
            <button
              onClick={() => setShowClose(true)}
              className="text-[12px] text-red-400 hover:text-red-500 transition-colors ml-2"
            >
              Cerrar caja →
            </button>
          )}
        </div>
      </div>

      {tiendas.length === 0 && (
        <p className="text-[13px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Todavía no hay ninguna sucursal creada — hace falta al menos una para poder operar la caja.
        </p>
      )}

      {tiendas.length > 1 && !tiendaId && (
        <p className="text-[13px] text-[#94A3B8]">Elegí una sucursal arriba para ver su caja.</p>
      )}

      {tiendaId && (
        <>
          {loadingSummary && <p className="text-[#CBD5E1] text-[13px]">Cargando...</p>}

          {error && <p className="text-[13px] text-red-500 mb-5">{error}</p>}

          {!loadingSummary && !session && canManage && (
            <div className="flex justify-center mb-8">
              <OpenPanel onOpen={openMutation.mutate} isPending={openMutation.isPending} />
            </div>
          )}
          {!loadingSummary && !session && !canManage && (
            <p className="text-[#94A3B8] text-[13px] text-center">No hay caja abierta hoy.</p>
          )}

      {!loadingSummary && session && isOpen && !showClose && (
        <div className="flex justify-center mb-8">
          <SessionSummaryCard session={session} />
        </div>
      )}

      {showClose && (
        <div className="flex justify-center mb-8">
          <ClosePanel
            byCurrency={byCurrency}
            onClose={closeMutation.mutate}
            isPending={closeMutation.isPending}
            onCancel={() => setShowClose(false)}
          />
        </div>
      )}

      {!loadingSummary && session && !isOpen && canManage && (
        <div className="flex justify-center mb-8">
          <OpenPanel onOpen={openMutation.mutate} isPending={openMutation.isPending} />
        </div>
      )}

      {session && (
        <>
          <div className="mb-6 space-y-3">
            {activeCurrencies.map((cur) => {
              const d = byCurrency[cur];
              return (
                <div key={cur}>
                  <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-widest mb-2">{cur}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Monto inicial"    value={fmtByCurrency(d.openingBalance, cur)} />
                    <StatCard label="Ventas"           value={fmtByCurrency(d.salesIncome, cur)}  accent="text-[#3B82F6]" />
                    <StatCard label="Ing. manuales"    value={fmtByCurrency(d.manualIncome, cur)} accent="text-emerald-600" />
                    <StatCard label="Egresos"          value={fmtByCurrency(d.expense, cur)}      accent="text-red-500" />
                  </div>
                </div>
              );
            })}
          </div>

          {Object.keys(byPayment).length > 0 && (
            <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 mb-6"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-3">Por medio de pago</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {Object.entries(byPayment).map(([pm, byCur]) =>
                  Object.entries(byCur).map(([cur, vals]) => (
                    <div key={`${pm}-${cur}`} className="flex items-baseline gap-2">
                      <span className="text-[11px] text-[#94A3B8]">{PAYMENT_LABELS[pm] ?? pm} · {cur}</span>
                      <span className="text-[13px] text-[#0F172A] font-medium">{fmtByCurrency(vals.income, cur)}</span>
                      {vals.expense > 0 && (
                        <span className="text-[11px] text-red-500">−{fmtByCurrency(vals.expense, cur)}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {activeCurrencies.map((cur) => (
              <BalanceCard key={cur} currencyCode={cur} data={byCurrency[cur]} />
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium">Movimientos</p>
              {canManage && isOpen && (
                <Link
                  to={`/cash/movements/new?tiendaId=${tiendaId}`}
                  className="text-[12px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
                >
                  + Nuevo
                </Link>
              )}
            </div>

            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              {loadingMov && (
                <p className="text-center py-10 text-[#CBD5E1] text-[13px]">Cargando...</p>
              )}
              {!loadingMov && movements.length === 0 && (
                <p className="text-center py-10 text-[#CBD5E1] text-[13px]">Sin movimientos aún.</p>
              )}
              {!loadingMov && movements.length > 0 && (
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
                      <tr
                        key={m.id}
                        className={`border-b border-[#E2E8F0] transition-colors ${m.saleId ? 'cursor-pointer hover:bg-[#F8FAFC]' : ''}`}
                        onClick={m.saleId ? () => setSelectedSaleId(m.saleId) : undefined}
                      >
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                            m.type === 'INCOME' ? 'text-emerald-600' : 'text-red-500'
                          }`}>
                            <span>{m.type === 'INCOME' ? '+' : '−'}</span>
                            <span>{m.type === 'INCOME' ? 'Ingreso' : 'Egreso'}</span>
                            {m.sale && (
                              <span className="text-[#CBD5E1] font-normal">venta</span>
                            )}
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
                        <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">
                          {fmtTime(m.createdAt)}
                        </td>
                        <td className="px-4 py-3.5 text-[#94A3B8] hidden lg:table-cell">
                          {m.createdBy?.name ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      <div className="mt-10">
        <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-3">Historial de cajas</p>
        <CashSessionsTable tiendaId={tiendaId} showTiendaColumn={false} />
      </div>
        </>
      )}
      {selectedSaleId && (
        <SaleDetailModal saleId={selectedSaleId} onClose={() => setSelectedSaleId(null)} />
      )}
    </div>
  );
};

export default CashMain;

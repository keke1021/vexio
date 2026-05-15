import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const PAYMENT_LABELS = {
  CASH:         'Efectivo',
  TRANSFER:     'Transferencia',
  CARD:         'Tarjeta',
  INSTALLMENTS: 'Cuotas',
};

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtUsd = (n) =>
  `USD ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—';

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const StatCard = ({ label, value, accent }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-2">{label}</p>
    <p className={`text-[22px] font-semibold tracking-tight ${accent ?? 'text-[#0F172A]'}`}>{value}</p>
  </div>
);

const BalanceCard = ({ currency, income, expense, initial = 0 }) => {
  const net = initial + income - expense;
  const fmtVal = currency === 'ARS' ? fmt : fmtUsd;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-3">
        Balance {currency}
      </p>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[13px]">
          <span className="text-[#94A3B8]">Ingresos</span>
          <span className="text-emerald-600 font-medium">{fmtVal(income)}</span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-[#94A3B8]">Egresos</span>
          <span className="text-red-500 font-medium">{fmtVal(expense)}</span>
        </div>
        <div className="border-t border-[#E2E8F0] pt-1.5 flex justify-between text-[13px]">
          <span className="text-[#64748B] font-medium">Saldo neto</span>
          <span className={`font-bold ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {fmtVal(net)}
          </span>
        </div>
      </div>
    </div>
  );
};

const OpenPanel = ({ onOpen, isPending }) => {
  const [amountARS, setAmountARS] = useState('');
  const [amountUSD, setAmountUSD] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 max-w-sm"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Abrir caja</p>
      <div className="flex gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <label className="block text-[13px] font-medium text-[#64748B] mb-2">Monto inicial ARS</label>
          <input
            type="number"
            placeholder="0"
            value={amountARS}
            onChange={(e) => setAmountARS(e.target.value)}
            min="0"
            step="100"
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-[13px] font-medium text-[#64748B] mb-2">Monto inicial USD</label>
          <input
            type="number"
            placeholder="0"
            value={amountUSD}
            onChange={(e) => setAmountUSD(e.target.value)}
            min="0"
            step="1"
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
          />
        </div>
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
          initialAmountARS: parseFloat(amountARS) || 0,
          initialAmountUSD: parseFloat(amountUSD) || 0,
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

const ClosePanel = ({ summary, onClose, isPending, onCancel }) => {
  const [notes, setNotes] = useState('');

  const income  = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const initial = summary?.session?.initialAmountARS ?? 0;
  const balance = initial + income - expense;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 max-w-sm"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Cerrar caja</p>

      <div className="space-y-2 mb-4">
        {[
          ['Monto inicial',  fmt(initial)],
          ['Ingresos',       fmt(income),  'text-emerald-600'],
          ['Egresos',       `-${fmt(expense)}`, 'text-red-500'],
        ].map(([label, val, cls]) => (
          <div key={label} className="flex justify-between text-[13px]">
            <span className="text-[#64748B]">{label}</span>
            <span className={cls ?? 'text-[#0F172A]'}>{val}</span>
          </div>
        ))}
        <div className="border-t border-[#E2E8F0] pt-2 flex justify-between text-[13px]">
          <span className="text-[#64748B] font-medium">Saldo final</span>
          <span className="text-[#0F172A] font-bold">{fmt(balance)}</span>
        </div>
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
          onClick={() => onClose({ notes: notes || undefined })}
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

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['cash-summary'],
    queryFn: () => api.get('/cash/summary').then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: movData, isLoading: loadingMov } = useQuery({
    queryKey: ['cash-movements'],
    queryFn: () => api.get('/cash/movements').then((r) => r.data),
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
    queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
  };

  const openMutation = useMutation({
    mutationFn: (data) => api.post('/cash/open', data).then((r) => r.data),
    onSuccess: () => { setError(''); invalidate(); },
    onError: (err) => setError(err.response?.data?.message || 'Error al abrir la caja.'),
  });

  const closeMutation = useMutation({
    mutationFn: (data) => api.post('/cash/close', data).then((r) => r.data),
    onSuccess: () => { setError(''); setShowClose(false); invalidate(); },
    onError: (err) => setError(err.response?.data?.message || 'Error al cerrar la caja.'),
  });

  const isOpen     = summary?.isOpen ?? false;
  const session    = summary?.session;
  const movements  = movData?.movements ?? [];
  const income     = summary?.income ?? 0;
  const expense    = summary?.expense ?? 0;
  const salesTotal = summary?.salesTotal ?? 0;
  const balance    = summary?.balance ?? 0;
  const byPayment  = summary?.byPaymentMethod ?? {};
  const byCurrency = summary?.byCurrency ?? {};

  const arsData = byCurrency['ARS'] ?? { income: 0, expense: 0 };
  const usdData = {
    income:  (byCurrency['USD']?.income  ?? 0) + (byCurrency['USDT']?.income  ?? 0),
    expense: (byCurrency['USD']?.expense ?? 0) + (byCurrency['USDT']?.expense ?? 0),
  };

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Caja</h1>
          {session && (
            <p className="text-[13px] text-[#94A3B8] mt-0.5">
              {isOpen
                ? `Abierta desde las ${fmtTime(session.openedAt)} · ${session.openedBy?.name}`
                : `Cerrada el ${fmtDate(session.closedAt)} a las ${fmtTime(session.closedAt)}`}
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

      {loadingSummary && <p className="text-[#CBD5E1] text-[13px]">Cargando...</p>}

      {error && <p className="text-[13px] text-red-500 mb-5">{error}</p>}

      {!loadingSummary && !session && canManage && (
        <OpenPanel onOpen={openMutation.mutate} isPending={openMutation.isPending} />
      )}
      {!loadingSummary && !session && !canManage && (
        <p className="text-[#94A3B8] text-[13px]">No hay caja abierta hoy.</p>
      )}

      {showClose && (
        <div className="mb-8">
          <ClosePanel
            summary={summary}
            onClose={closeMutation.mutate}
            isPending={closeMutation.isPending}
            onCancel={() => setShowClose(false)}
          />
        </div>
      )}

      {!loadingSummary && session && !isOpen && canManage && (
        <div className="mb-8">
          <OpenPanel onOpen={openMutation.mutate} isPending={openMutation.isPending} />
        </div>
      )}

      {session && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Monto inicial"     value={fmt(session.initialAmount)} />
            <StatCard label="Ventas"            value={fmt(salesTotal)} accent="text-[#3B82F6]" />
            <StatCard label="Ingresos manuales" value={fmt(income - salesTotal)} accent="text-emerald-600" />
          </div>

          {Object.keys(byPayment).length > 0 && (
            <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 mb-6"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-3">Por medio de pago</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {Object.entries(byPayment).map(([pm, vals]) => (
                  <div key={pm} className="flex items-baseline gap-2">
                    <span className="text-[11px] text-[#94A3B8]">{PAYMENT_LABELS[pm] ?? pm}</span>
                    <span className="text-[13px] text-[#0F172A] font-medium">{fmt(vals.income)}</span>
                    {vals.expense > 0 && (
                      <span className="text-[11px] text-red-500">−{fmt(vals.expense)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <BalanceCard
              currency="ARS"
              income={arsData.income}
              expense={arsData.expense}
              initial={summary?.session?.initialAmountARS ?? 0}
            />
            <BalanceCard
              currency="USD"
              income={usdData.income}
              expense={usdData.expense}
              initial={summary?.session?.initialAmountUSD ?? 0}
            />
          </div>

          {expense > 0 && (
            <div className="flex justify-between items-center text-[13px] mb-6 px-1">
              <span className="text-[#94A3B8]">Total egresos del día</span>
              <span className="text-red-500 font-medium">−{fmt(expense)}</span>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium">Movimientos</p>
              {canManage && isOpen && (
                <Link
                  to="/cash/movements/new"
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
                          {m.type === 'INCOME' ? '+' : '−'}{fmt(m.amount)}
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
    </div>
  );
};

export default CashMain;

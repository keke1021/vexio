import { useState, Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const STATUS_CONFIG = {
  PENDING:   { label: 'Pendiente', cls: 'text-orange-500 bg-orange-50' },
  RECEIVED:  { label: 'Recibida',  cls: 'text-emerald-600 bg-emerald-50' },
  CANCELLED: { label: 'Cancelada', cls: 'text-[#94A3B8] bg-[#F1F5F9]' },
};

const CURRENCIES = ['ARS', 'USD', 'USDT'];

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtGeneric = (n, code) =>
  `${code} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

// Antes esta tabla mostraba fmt(o.total) (formato de pesos) sin importar la
// moneda real de la orden — una orden en USD se veía con el símbolo $ de ARS.
const fmtByCurrency = (n, code) => (code === 'ARS' ? fmt(n) : fmtGeneric(n, code));

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const SOURCE_LABELS = {
  CASH_REGISTER: 'Caja del local',
  EXTERNAL:      'Cuenta externa',
};

const SOURCE_BADGE_CLS = {
  CASH_REGISTER: 'text-[#3B82F6] bg-[#EFF6FF]',
  EXTERNAL:      'text-[#94A3B8] bg-[#F1F5F9]',
};

// Uno o dos badges según paymentSources (["CASH_REGISTER"], ["EXTERNAL"], o
// ambos si la orden se pagó parte de caja y parte externa — nunca se elige
// uno arbitrariamente en ese caso, se muestran los dos). null si la orden
// todavía no tiene ningún pago.
const SourceBadges = ({ sources }) => {
  if (!sources?.length) return null;
  return (
    <span className="inline-flex gap-1 flex-wrap justify-end">
      {sources.map((s) => (
        <span
          key={s}
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${SOURCE_BADGE_CLS[s] ?? SOURCE_BADGE_CLS.EXTERNAL}`}
        >
          {SOURCE_LABELS[s] ?? s}
        </span>
      ))}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const StatCard = ({ label, value, sub }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-4 py-3.5"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-1.5">{label}</p>
    <p className="text-[20px] font-bold tracking-tight text-[#0F172A]">{value}</p>
    {sub && <p className="text-[11px] text-[#94A3B8] mt-0.5">{sub}</p>}
  </div>
);

// Fila expandible bajo una orden — historial de pagos + form para registrar
// uno nuevo. Mismo patrón de sucursal que Caja/POS/nueva orden: auto-
// preseleccionada si hay una sola, seleccionable si hay más de una.
const PaymentPanel = ({ order, tiendas, onSubmit, isPending, error }) => {
  const [amount, setAmount]     = useState('');
  const [source, setSource]     = useState('CASH_REGISTER');
  const [tiendaId, setTiendaId] = useState('');

  const effectiveTiendaId = tiendaId || (tiendas.length === 1 ? tiendas[0].id : '');
  const canSubmit = parseFloat(amount) > 0 && (source === 'EXTERNAL' || !!effectiveTiendaId);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      amount: parseFloat(amount),
      source,
      tiendaId: source === 'CASH_REGISTER' ? effectiveTiendaId : undefined,
    }, () => { setAmount(''); });
  };

  return (
    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
      <td colSpan={6} className="px-4 py-4">
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <p className="text-[10px] text-[#94A3B8] uppercase tracking-[0.12em] mb-2">Historial de pagos</p>
            {(!order.payments || order.payments.length === 0) ? (
              <p className="text-[12px] text-[#CBD5E1]">Todavía no se registró ningún pago.</p>
            ) : (
              <div className="space-y-1.5">
                {order.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-[12px] bg-white border border-[#E2E8F0] rounded-lg px-3 py-2">
                    <div>
                      <p className="text-[#0F172A] font-medium">{fmtByCurrency(p.amount, p.currencyCode)}</p>
                      <p className="text-[#94A3B8]">
                        {SOURCE_LABELS[p.source] ?? p.source}{p.tienda ? ` · ${p.tienda.name}` : ''} · {p.paidBy?.name ?? '—'}
                      </p>
                    </div>
                    <p className="text-[#94A3B8]">{fmtDate(p.paidAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] text-[#94A3B8] uppercase tracking-[0.12em] mb-2">Registrar pago</p>
            {order.pending <= 0 ? (
              <p className="text-[12px] text-emerald-600">Orden saldada — no queda pendiente.</p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-2.5">
                <input
                  type="number"
                  placeholder={`Monto (pendiente: ${fmtByCurrency(order.pending, order.currencyCode)})`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0"
                  step="0.01"
                  max={order.pending}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
                    placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
                />
                <div className="flex gap-2">
                  {[
                    { value: 'CASH_REGISTER', label: 'Caja del local' },
                    { value: 'EXTERNAL',      label: 'Cuenta externa' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSource(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                        source === opt.value
                          ? 'bg-[#3B82F6] text-white border-transparent'
                          : 'bg-white border-[#E2E8F0] text-[#94A3B8] hover:text-[#64748B]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {source === 'CASH_REGISTER' && tiendas.length > 1 && (
                  <select
                    value={effectiveTiendaId}
                    onChange={(e) => setTiendaId(e.target.value)}
                    className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
                      focus:outline-none focus:border-[#3B82F6] transition-all"
                  >
                    <option value="">Seleccioná una sucursal</option>
                    {tiendas.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
                {source === 'CASH_REGISTER' && tiendas.length === 0 && (
                  <p className="text-[12px] text-amber-600">No hay ninguna sucursal creada — no se puede pagar desde caja.</p>
                )}
                {error && <p className="text-[12px] text-red-500">{error}</p>}
                <button
                  type="submit"
                  disabled={!canSubmit || isPending}
                  className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[12px] font-medium px-4 py-2
                    rounded-lg transition-colors disabled:opacity-40"
                >
                  {isPending ? 'Registrando...' : 'Registrar pago'}
                </button>
              </form>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
};

const SuppliersDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = ['OWNER', 'ADMIN'].includes(user?.role);

  const [confirmCancel, setConfirmCancel] = useState(null);
  const [actionError, setActionError] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [paymentError, setPaymentError] = useState('');

  const { data: supplier, isLoading: loadingSupplier } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.get(`/suppliers/${id}`).then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: ordersData, isLoading: loadingOrders } = useQuery({
    queryKey: ['supplier-orders', id],
    queryFn: () => api.get(`/suppliers/${id}/orders`).then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['supplier', id] });
    queryClient.invalidateQueries({ queryKey: ['supplier-orders', id] });
    queryClient.invalidateQueries({ queryKey: ['suppliers'] });
  };

  const orderMutation = useMutation({
    mutationFn: ({ orderId, status }) =>
      api.put(`/suppliers/${id}/orders/${orderId}`, { status }).then((r) => r.data),
    onSuccess: () => { setActionError(''); setConfirmCancel(null); invalidate(); },
    onError: (err) => setActionError(err.response?.data?.message || 'Error al actualizar la orden.'),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ orderId, data }) =>
      api.post(`/suppliers/orders/${orderId}/payments`, data).then((r) => r.data),
    onSuccess: () => { setPaymentError(''); invalidate(); },
    onError: (err) => setPaymentError(err.response?.data?.message || 'Error al registrar el pago.'),
  });

  const orders = ordersData?.orders ?? [];
  const stats  = supplier?.stats;

  if (loadingSupplier) {
    return <div className="px-6 pt-8 text-[#CBD5E1] text-[13px]">Cargando...</div>;
  }
  if (!supplier) {
    return (
      <div className="px-6 pt-8">
        <p className="text-[#94A3B8] text-[13px]">Proveedor no encontrado.</p>
        <Link to="/suppliers" className="text-[#3B82F6] text-[13px] mt-2 inline-block">← Volver</Link>
      </div>
    );
  }

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-center gap-3 mb-8">
        <Link to="/suppliers" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Proveedores</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">{supplier.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">{supplier.name}</h1>
          <p className="text-[13px] text-[#94A3B8] mt-0.5">{supplier.city}</p>
        </div>
        {canWrite && (
          <Link
            to={`/suppliers/${id}/orders/new`}
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Nueva orden
          </Link>
        )}
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {[
          ['Teléfono', supplier.phone ?? '—'],
          ['Email',    supplier.email ?? '—'],
          ['Plazo de pago', `${supplier.paymentDays} días`],
          ['Items en inventario', supplier._count?.items ?? 0],
        ].map(([label, val]) => (
          <div key={label}>
            <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-1">{label}</p>
            <p className="text-[13px] text-[#0F172A]">{val}</p>
          </div>
        ))}
        {supplier.notes && (
          <div className="col-span-2 sm:col-span-4 border-t border-[#E2E8F0] pt-3 mt-1">
            <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-1">Notas</p>
            <p className="text-[13px] text-[#64748B]">{supplier.notes}</p>
          </div>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {/* Una StatCard por moneda con deuda pendiente — nunca un total
              único mezclando ARS/USD/USDT */}
          {CURRENCIES.filter((c) => stats.debtByCurrency?.[c]).map((cur) => (
            <StatCard
              key={`debt-${cur}`}
              label={`Pendiente de recibir ${cur}`}
              value={fmtByCurrency(stats.debtByCurrency[cur].total, cur)}
              sub={`${stats.debtByCurrency[cur].count} orden${stats.debtByCurrency[cur].count !== 1 ? 'es' : ''}`}
            />
          ))}
          {CURRENCIES.filter((c) => stats.receivedByCurrency?.[c]).map((cur) => (
            <StatCard
              key={`received-${cur}`}
              label={`Total recibido ${cur}`}
              value={fmtByCurrency(stats.receivedByCurrency[cur].total, cur)}
              sub={`${stats.receivedByCurrency[cur].count} orden${stats.receivedByCurrency[cur].count !== 1 ? 'es' : ''}`}
            />
          ))}
          <StatCard
            label="Órdenes totales"
            value={Object.values(stats.ordersByStatus ?? {}).reduce((s, n) => s + n, 0)}
          />
        </div>
      )}

      {actionError && <p className="text-[13px] text-red-500 mb-4">{actionError}</p>}

      <div>
        <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-3">
          Historial de órdenes
        </p>

        <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {loadingOrders && (
            <p className="text-center py-10 text-[#CBD5E1] text-[13px]">Cargando...</p>
          )}
          {!loadingOrders && orders.length === 0 && (
            <p className="text-center py-10 text-[#CBD5E1] text-[13px]">
              Sin órdenes.{' '}
              {canWrite && (
                <Link to={`/suppliers/${id}/orders/new`} className="text-[#3B82F6] hover:underline">
                  Crear la primera
                </Link>
              )}
            </p>
          )}
          {!loadingOrders && orders.length > 0 && (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Fecha</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Items</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Notas</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Total</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Estado</th>
                  {canWrite && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <Fragment key={o.id}>
                  <tr className="border-b border-[#E2E8F0]">
                    <td className="px-4 py-3.5">
                      <p className="text-[#64748B]">{fmtDate(o.createdAt)}</p>
                      {o.receivedAt && (
                        <p className="text-[11px] text-[#94A3B8]">Recibida {fmtDate(o.receivedAt)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-[#94A3B8] hidden sm:table-cell">
                      {o._count?.items ?? o.items?.length ?? 0} ítem{(o._count?.items ?? 1) !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3.5 text-[#94A3B8] text-[12px] hidden md:table-cell max-w-[200px] truncate">
                      {o.notes ?? '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      <p className="text-[#0F172A] font-medium">{fmtByCurrency(o.total, o.currencyCode)}</p>
                      {o.paid > 0 && (
                        <p className="text-[11px] text-[#94A3B8] mt-0.5">
                          {o.pending > 0
                            ? `${fmtByCurrency(o.paid, o.currencyCode)} pagado`
                            : 'Pagado completo'}
                        </p>
                      )}
                      {o.paymentSources?.length > 0 && (
                        <div className="mt-1">
                          <SourceBadges sources={o.paymentSources} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={o.status} />
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          {o.status === 'PENDING' && (
                            <button
                              onClick={() => orderMutation.mutate({ orderId: o.id, status: 'RECEIVED' })}
                              disabled={orderMutation.isPending}
                              className="text-[11px] text-emerald-600 hover:text-emerald-700 transition-colors disabled:opacity-40"
                            >
                              Recibida
                            </button>
                          )}
                          {o.status !== 'CANCELLED' && (
                            <button
                              onClick={() => { setPaymentError(''); setExpandedOrderId(expandedOrderId === o.id ? null : o.id); }}
                              className="text-[11px] text-[#3B82F6] hover:text-[#2563EB] transition-colors"
                            >
                              {expandedOrderId === o.id ? 'Cerrar' : 'Registrar pago'}
                            </button>
                          )}
                          {o.status === 'PENDING' && (
                            confirmCancel === o.id ? (
                              <span className="flex items-center gap-1.5">
                                <button
                                  onClick={() => orderMutation.mutate({ orderId: o.id, status: 'CANCELLED' })}
                                  disabled={orderMutation.isPending}
                                  className="text-[11px] text-red-500 hover:text-red-600 transition-colors disabled:opacity-40"
                                >
                                  Confirmar
                                </button>
                                <button
                                  onClick={() => setConfirmCancel(null)}
                                  className="text-[11px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmCancel(o.id)}
                                className="text-[11px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
                              >
                                Cancelar
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {expandedOrderId === o.id && (
                    <PaymentPanel
                      order={o}
                      tiendas={tiendas}
                      isPending={paymentMutation.isPending}
                      error={paymentError}
                      onSubmit={(data, onDone) =>
                        paymentMutation.mutate({ orderId: o.id, data }, { onSuccess: onDone })
                      }
                    />
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default SuppliersDetail;

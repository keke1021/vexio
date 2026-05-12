import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const STATUS_CONFIG = {
  PENDING:   { label: 'Pendiente', cls: 'text-orange-500 bg-orange-50' },
  RECEIVED:  { label: 'Recibida',  cls: 'text-emerald-600 bg-emerald-50' },
  CANCELLED: { label: 'Cancelada', cls: 'text-[#94A3B8] bg-[#F1F5F9]' },
};

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

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

const SuppliersDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = ['OWNER', 'ADMIN'].includes(user?.role);

  const [confirmCancel, setConfirmCancel] = useState(null);
  const [actionError, setActionError] = useState('');

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
          <StatCard
            label="Deuda pendiente"
            value={fmt(stats.totalDebt)}
            sub={stats.pendingOrders ? `${stats.pendingOrders} orden${stats.pendingOrders !== 1 ? 'es' : ''}` : 'Sin deuda'}
          />
          <StatCard
            label="Total recibido"
            value={fmt(stats.totalReceived)}
            sub={stats.receivedOrders ? `${stats.receivedOrders} orden${stats.receivedOrders !== 1 ? 'es' : ''}` : ''}
          />
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
                  <tr key={o.id} className="border-b border-[#E2E8F0]">
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
                    <td className="px-4 py-3.5 text-right text-[#0F172A] font-medium tabular-nums">
                      {fmt(o.total)}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={o.status} />
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3.5">
                        {o.status === 'PENDING' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => orderMutation.mutate({ orderId: o.id, status: 'RECEIVED' })}
                              disabled={orderMutation.isPending}
                              className="text-[11px] text-emerald-600 hover:text-emerald-700 transition-colors disabled:opacity-40"
                            >
                              Recibida
                            </button>
                            {confirmCancel === o.id ? (
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
                            )}
                          </div>
                        )}
                      </td>
                    )}
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

export default SuppliersDetail;

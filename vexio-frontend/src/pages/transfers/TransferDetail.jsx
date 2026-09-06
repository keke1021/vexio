import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const ITEM_STATUS_CFG = {
  PREPARING:  { label: 'En preparación', cls: 'text-[#475569] bg-[#F1F5F9]' },
  DISPATCHED: { label: 'En camino',      cls: 'text-amber-600 bg-amber-50' },
  RECEIVED:   { label: 'Recibido',       cls: 'text-emerald-600 bg-emerald-50' },
  CANCELLED:  { label: 'Cancelado',      cls: 'text-red-500 bg-red-50' },
};

const UNRESTRICTED_ROLES = ['OWNER', 'ADMIN', 'SUPERADMIN'];

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

// ─── Despachar (OPEN → DISPATCHED) ──────────────────────────────────────────────

const DispatchPanel = ({ transferId, onDone }) => {
  const [deliveryId, setDeliveryId] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api.get('/stock-transfers/deliveries').then((r) => r.data),
    staleTime: 60_000,
  });
  const deliveries = data?.deliveries ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/stock-transfers/${transferId}/dispatch`, creatingNew
        ? { newDelivery: { name: newName, phone: newPhone } }
        : { deliveryId }
      ).then((r) => r.data),
    onSuccess: () => { setError(''); onDone(); },
    onError: (err) => setError(err.response?.data?.message || 'Error al despachar el lote.'),
  });

  const canSubmit = creatingNew ? newName.trim() && newPhone.trim() : !!deliveryId;

  return (
    <div className="border border-[#E2E8F0] rounded-xl p-5 mb-6 bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[12px] text-[#3B82F6] font-medium uppercase tracking-wider mb-1">Despachar lote</p>
      <p className="text-[12px] text-[#475569] mb-4">Hace falta asociar un delivery antes de marcarlo como en camino.</p>

      {!creatingNew ? (
        <>
          <select
            value={deliveryId}
            onChange={(e) => setDeliveryId(e.target.value)}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] mb-2
              focus:outline-none focus:border-[#3B82F6] transition-all"
          >
            <option value="">Elegí un delivery</option>
            {deliveries.map((d) => (
              <option key={d.id} value={d.id}>{d.name} · {d.phone}</option>
            ))}
          </select>
          <button
            onClick={() => setCreatingNew(true)}
            className="text-[12px] text-[#3B82F6] hover:text-[#2563EB] transition-colors mb-3 block"
          >
            + Agregar delivery nuevo
          </button>
        </>
      ) : (
        <div className="space-y-2 mb-3">
          <input
            placeholder="Nombre"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
          />
          <input
            placeholder="Teléfono"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
          />
          <button
            onClick={() => setCreatingNew(false)}
            className="text-[12px] text-[#475569] hover:text-[#64748B] transition-colors"
          >
            Usar uno ya cargado
          </button>
        </div>
      )}

      {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !canSubmit}
        className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-5 py-2 rounded-lg
          transition-colors disabled:opacity-40"
      >
        {mutation.isPending ? 'Despachando...' : 'Confirmar despacho'}
      </button>
    </div>
  );
};

// ─── Cancelar un ítem (con motivo obligatorio) ──────────────────────────────────

const CancelItemModal = ({ onConfirm, onClose, isPending }) => {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-[13px] font-medium text-[#0F172A] mb-3">Motivo de la cancelación</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Ej: se perdió en el traslado"
          className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
            placeholder-[#CBD5E1] mb-4 focus:outline-none focus:border-[#3B82F6] resize-none"
        />
        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(reason)}
            disabled={!reason.trim() || isPending}
            className="bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 text-[13px] font-medium
              px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
          >
            {isPending ? 'Cancelando...' : 'Confirmar cancelación'}
          </button>
          <button onClick={onClose} className="text-[13px] text-[#475569] hover:text-[#64748B] transition-colors">
            Volver
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Página principal ───────────────────────────────────────────────────────────

const TransferDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState(null);
  const [actionError, setActionError] = useState('');

  const { data: transfer, isLoading } = useQuery({
    queryKey: ['stock-transfer', id],
    queryFn: () => api.get(`/stock-transfers/${id}`).then((r) => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['stock-transfer', id] });
    queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const onActionError = (fallback) => (err) => setActionError(err.response?.data?.message || fallback);

  const receiveAllMutation = useMutation({
    mutationFn: () => api.post(`/stock-transfers/${id}/receive-all`).then((r) => r.data),
    onSuccess: () => { setActionError(''); invalidate(); },
    onError: onActionError('Error al aceptar el lote completo.'),
  });
  const receiveItemMutation = useMutation({
    mutationFn: (itemId) => api.post(`/stock-transfers/${id}/items/${itemId}/receive`).then((r) => r.data),
    onSuccess: () => { setActionError(''); invalidate(); },
    onError: onActionError('Error al recibir el equipo — puede que ya lo hayan resuelto desde otro lado.'),
  });
  const cancelItemMutation = useMutation({
    mutationFn: ({ itemId, reason }) => api.post(`/stock-transfers/${id}/items/${itemId}/cancel`, { reason }).then((r) => r.data),
    onSuccess: () => { setActionError(''); invalidate(); setCancelTarget(null); },
    onError: (err) => { onActionError('Error al cancelar el equipo — puede que ya lo hayan resuelto desde otro lado.')(err); setCancelTarget(null); },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 rounded-full border-2 border-[#E2E8F0] border-t-[#3B82F6] animate-spin" />
      </div>
    );
  }
  if (!transfer) {
    return (
      <div className="px-6 pt-12 text-center text-[#475569] text-[13px]">
        <p>Transferencia no encontrada.</p>
        <Link to="/transfers" className="text-[#3B82F6] hover:underline mt-2 block">Volver a Transferencias</Link>
      </div>
    );
  }

  // Solo para mostrar/ocultar acciones — el enforcement real es siempre
  // server-side (assertTiendaAccess), esto es puramente para no ofrecer un
  // botón que el backend va a rechazar con 403.
  const unrestricted = UNRESTRICTED_ROLES.includes(user?.role);
  const isOrigin = unrestricted || user?.tiendaId === transfer.fromTienda.id;
  const isDest   = unrestricted || user?.tiendaId === transfer.toTienda.id;

  return (
    <div className="px-6 pt-8 pb-16 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link to="/transfers" className="text-[#475569] hover:text-[#64748B] transition-colors text-[13px]">
          ← Transferencias
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#0F172A]">
          {transfer.fromTienda.name} → {transfer.toTienda.name}
        </h1>
        <p className="text-[13px] text-[#475569] mt-1">
          Creado por {transfer.createdBy?.name ?? '—'} el {fmtDateTime(transfer.createdAt)}
        </p>
        {transfer.delivery && (
          <p className="text-[13px] text-[#475569] mt-1">
            Delivery: {transfer.delivery.name} · {transfer.delivery.phone}
          </p>
        )}
        {transfer.closedAt && (
          <p className="text-[13px] text-[#475569] mt-1">Cerrado el {fmtDateTime(transfer.closedAt)}</p>
        )}
      </div>

      {actionError && (
        <p className="text-[13px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6">
          {actionError}
        </p>
      )}

      {transfer.status === 'OPEN' && isOrigin && (
        <DispatchPanel transferId={id} onDone={invalidate} />
      )}
      {transfer.status === 'OPEN' && !isOrigin && (
        <p className="text-[13px] text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-4 py-3 mb-6">
          Este lote todavía se está armando en {transfer.fromTienda.name}.
        </p>
      )}

      {transfer.status === 'DISPATCHED' && isDest && (
        <div className="border border-[#E2E8F0] rounded-xl p-5 mb-6 bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p className="text-[13px] text-[#0F172A] mb-1 font-medium">¿Llegó todo bien?</p>
          <p className="text-[12px] text-[#475569] mb-3">
            "Aceptar lote completo" es el atajo para cuando llegó todo — si falta algún equipo, recibí ítem por
            ítem más abajo en vez de aceptar todo entero y generar un desfasaje falso.
          </p>
          <button
            onClick={() => receiveAllMutation.mutate()}
            disabled={receiveAllMutation.isPending}
            className="bg-emerald-500 hover:bg-emerald-600 text-white text-[13px] font-medium px-5 py-2 rounded-lg
              transition-colors disabled:opacity-40"
          >
            {receiveAllMutation.isPending ? 'Confirmando...' : 'Aceptar lote completo'}
          </button>
        </div>
      )}

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {transfer.transferItems.map((ti) => {
          const cfg = ITEM_STATUS_CFG[ti.status] ?? { label: ti.status, cls: 'text-[#475569] bg-[#F1F5F9]' };
          const canCancel = (isOrigin || isDest) && ['PREPARING', 'DISPATCHED'].includes(ti.status);
          const canReceive = isDest && ti.status === 'DISPATCHED';

          return (
            <div key={ti.id} className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0] last:border-0">
              <div>
                <p className="text-[13px] text-[#0F172A] font-medium">
                  {[ti.inventoryItem.product?.name, ti.inventoryItem.product?.color, ti.inventoryItem.product?.storage]
                    .filter(Boolean).join(' ')}
                </p>
                <p className="text-[11px] text-[#475569] mt-0.5 font-mono">{ti.inventoryItem.imei}</p>
                {ti.status === 'CANCELLED' && ti.cancelReason && (
                  <p className="text-[11px] text-red-500 mt-0.5">Motivo: {ti.cancelReason}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>{cfg.label}</span>
                {canReceive && (
                  <button
                    onClick={() => receiveItemMutation.mutate(ti.id)}
                    disabled={receiveItemMutation.isPending}
                    className="text-[11px] text-emerald-600 hover:text-emerald-700 transition-colors disabled:opacity-40"
                  >
                    Recibir
                  </button>
                )}
                {canCancel && (
                  <button
                    onClick={() => setCancelTarget(ti.id)}
                    className="text-[11px] text-red-400 hover:text-red-500 transition-colors"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {cancelTarget && (
        <CancelItemModal
          isPending={cancelItemMutation.isPending}
          onConfirm={(reason) => cancelItemMutation.mutate({ itemId: cancelTarget, reason })}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
};

export default TransferDetail;

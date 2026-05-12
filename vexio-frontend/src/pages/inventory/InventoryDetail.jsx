import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const CONDITIONS = { NEW: 'Nuevo (sellado)', LIKE_NEW: 'Como nuevo', REFURBISHED: 'Reacondicionado', USED: 'Usado' };
const STATUS_OPTIONS = [
  { value: 'AVAILABLE', label: 'Disponible' },
  { value: 'RESERVED', label: 'Reservado' },
  { value: 'SOLD', label: 'Vendido' },
];
const CONDITION_OPTIONS = Object.entries(CONDITIONS).map(([v, l]) => ({ value: v, label: l }));

const formatCurrency = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

const formatDateTime = (d) =>
  new Date(d).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const getMarginColor = (m) => {
  if (m >= 30) return 'text-emerald-600';
  if (m >= 10) return 'text-yellow-600';
  return 'text-red-500';
};

const Row = ({ label, children }) => (
  <div className="flex items-start justify-between py-3.5 border-b border-[#E2E8F0] last:border-0">
    <span className="text-[12px] text-[#94A3B8] uppercase tracking-wider">{label}</span>
    <span className="text-[13px] text-[#0F172A] text-right max-w-[60%]">{children}</span>
  </div>
);

const InventoryDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = ['OWNER', 'ADMIN'].includes(user?.role);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [confirmBaja, setConfirmBaja] = useState(false);

  const { data: item, isLoading, isError } = useQuery({
    queryKey: ['inventory', id],
    queryFn: () => api.get(`/inventory/${id}`).then((r) => r.data),
    onSuccess: (data) => {
      setEditForm({
        costPrice: data.costPrice,
        salePrice: data.salePrice,
        condition: data.condition,
        status: data.status,
        notes: data.notes ?? '',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.put(`/inventory/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setIsEditing(false);
    },
  });

  const bajaMutation = useMutation({
    mutationFn: () => api.delete(`/inventory/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      navigate('/inventory');
    },
  });

  const startEdit = () => {
    setEditForm({
      costPrice: item.costPrice,
      salePrice: item.salePrice,
      condition: item.condition,
      status: item.status,
      notes: item.notes ?? '',
    });
    setIsEditing(true);
  };

  const liveMargin = (() => {
    const c = parseFloat(editForm.costPrice);
    const s = parseFloat(editForm.salePrice);
    if (!s) return null;
    return (((s - c) / s) * 100).toFixed(1);
  })();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 rounded-full border-2 border-[#E2E8F0] border-t-[#3B82F6] animate-spin" />
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="px-6 pt-12 text-center text-[#94A3B8] text-[13px]">
        <p>Equipo no encontrado.</p>
        <Link to="/inventory" className="text-[#3B82F6] hover:underline mt-2 block">Volver al inventario</Link>
      </div>
    );
  }

  const displayMargin = isEditing ? liveMargin : item.margin;

  return (
    <div className="px-6 pt-8 pb-16 max-w-xl mx-auto">

      <div className="flex items-center gap-3 mb-8">
        <Link to="/inventory" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">
          ← Inventario
        </Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="font-mono text-[12px] text-[#64748B]">{item.imei}</span>
      </div>

      <div className="mb-8">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">{item.product.name}</h1>
        <p className="text-[14px] text-[#64748B] mt-1">{item.product.color} · {item.product.storage}</p>
        <div className="mt-4 flex items-baseline gap-2">
          <span className={`text-[32px] font-bold leading-none ${getMarginColor(displayMargin)}`}>
            {displayMargin != null ? `${parseFloat(displayMargin).toFixed(1)}%` : '—'}
          </span>
          <span className="text-[13px] text-[#94A3B8]">de margen</span>
        </div>
      </div>

      <div className="border border-[#E2E8F0] rounded-xl px-5 mb-5 bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <Row label="IMEI">
          <span className="font-mono">{item.imei}</span>
        </Row>
        <Row label="Condición">{CONDITIONS[item.condition]}</Row>
        <Row label="Estado">{STATUS_OPTIONS.find((s) => s.value === item.status)?.label ?? item.status}</Row>
        <Row label="Costo">{formatCurrency(item.costPrice)}</Row>
        <Row label="Precio de venta">{formatCurrency(item.salePrice)}</Row>
        <Row label="Ganancia">{formatCurrency(item.salePrice - item.costPrice)}</Row>
        <Row label="Proveedor">{item.supplier?.name ?? '—'}</Row>
        <Row label="Stock del modelo">
          {item.stockCount} {item.stockCount === 1 ? 'unidad disponible' : 'unidades disponibles'}
        </Row>
        {item.accessories?.length > 0 && (
          <Row label="Accesorios">{item.accessories.join(', ')}</Row>
        )}
        {item.notes && (
          <Row label="Notas">{item.notes}</Row>
        )}
      </div>

      {isEditing && (
        <div className="border border-[#3B82F6]/30 rounded-xl p-5 mb-5 bg-[#EFF6FF]/40">
          <p className="text-[12px] text-[#3B82F6] font-medium uppercase tracking-wider mb-4">Editar</p>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Costo</label>
                <input
                  type="number"
                  value={editForm.costPrice}
                  onChange={(e) => setEditForm((p) => ({ ...p, costPrice: e.target.value }))}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#3B82F6]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Precio venta</label>
                <input
                  type="number"
                  value={editForm.salePrice}
                  onChange={(e) => setEditForm((p) => ({ ...p, salePrice: e.target.value }))}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#3B82F6]"
                />
              </div>
            </div>
            {liveMargin !== null && (
              <p className={`text-[13px] font-medium ${getMarginColor(parseFloat(liveMargin))}`}>
                Margen: {liveMargin}%
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Condición</label>
                <select
                  value={editForm.condition}
                  onChange={(e) => setEditForm((p) => ({ ...p, condition: e.target.value }))}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B] focus:outline-none focus:border-[#3B82F6]"
                >
                  {CONDITION_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Estado</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B] focus:outline-none focus:border-[#3B82F6]"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Notas</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] resize-none"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => updateMutation.mutate(editForm)}
                disabled={updateMutation.isPending}
                className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-40"
              >
                {updateMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {canWrite && !isEditing && (
        <div className="flex items-center gap-3">
          <button
            onClick={startEdit}
            className="bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B]
              text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Editar
          </button>
          {!confirmBaja ? (
            <button
              onClick={() => setConfirmBaja(true)}
              className="text-[13px] text-red-400 hover:text-red-500 transition-colors"
            >
              Dar de baja
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[#64748B]">¿Confirmás la baja?</span>
              <button
                onClick={() => bajaMutation.mutate()}
                disabled={bajaMutation.isPending}
                className="text-[12px] text-red-500 hover:text-red-600 font-medium transition-colors"
              >
                {bajaMutation.isPending ? 'Procesando...' : 'Sí, dar de baja'}
              </button>
              <button
                onClick={() => setConfirmBaja(false)}
                className="text-[12px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-10 border-t border-[#E2E8F0] pt-6">
        <p className="text-[11px] text-[#94A3B8] uppercase tracking-wider mb-3">Historial</p>
        <div className="space-y-2">
          <div className="flex justify-between text-[12px]">
            <span className="text-[#94A3B8]">Creado</span>
            <span className="text-[#64748B]">{formatDateTime(item.createdAt)}</span>
          </div>
          {item.updatedAt !== item.createdAt && (
            <div className="flex justify-between text-[12px]">
              <span className="text-[#94A3B8]">Última modificación</span>
              <span className="text-[#64748B]">{formatDateTime(item.updatedAt)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryDetail;

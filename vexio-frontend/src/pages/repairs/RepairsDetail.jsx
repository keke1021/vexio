import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { StatusBadge, STATUS_CONFIG, FAULT_LABELS } from './RepairsList';

const TRANSITIONS = {
  RECEIVED:      [{ to: 'DIAGNOSING',   label: 'Iniciar diagnóstico' }],
  DIAGNOSING:    [{ to: 'IN_PROGRESS',  label: 'Comenzar reparación' }],
  IN_PROGRESS:   [
    { to: 'WAITING_PARTS', label: 'Esperando repuestos' },
    { to: 'READY',         label: 'Marcar como listo', primary: true },
  ],
  WAITING_PARTS: [
    { to: 'IN_PROGRESS', label: 'Reanudar reparación' },
    { to: 'READY',       label: 'Marcar como listo', primary: true },
  ],
  READY:      [{ to: 'DELIVERED', label: 'Registrar entrega', primary: true }],
  DELIVERED:  [],
  CANCELLED:  [],
};

const formatCurrency = (n) =>
  n != null ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n) : '—';

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const formatDateTime = (d) =>
  new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const refId = (id) => id?.slice(-5).toUpperCase();

// ─── Timeline ─────────────────────────────────────────────────────────────────

const Timeline = ({ history }) => (
  <div className="relative pl-5">
    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#E2E8F0]" />
    <div className="space-y-5">
      {history.map((entry, idx) => {
        const isLast = idx === history.length - 1;
        return (
          <div key={entry.id} className="relative flex gap-4">
            <div className={`absolute -left-5 mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 ${
              isLast
                ? 'border-[#3B82F6] bg-[#EFF6FF]'
                : 'border-[#E2E8F0] bg-white'
            }`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={entry.status} />
                <span className="text-[11px] text-[#94A3B8]">{formatDateTime(entry.createdAt)}</span>
              </div>
              {entry.notes && (
                <p className="mt-1 text-[12px] text-[#64748B] italic">&ldquo;{entry.notes}&rdquo;</p>
              )}
              <p className="mt-0.5 text-[11px] text-[#CBD5E1]">por {entry.changedBy?.name}</p>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

// ─── Advance Status Panel ─────────────────────────────────────────────────────

const AdvancePanel = ({ repair, onAdvance, isLoading }) => {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [pendingTransition, setPendingTransition] = useState(null);
  const canCancel = ['OWNER', 'ADMIN'].includes(user?.role);
  const transitions = TRANSITIONS[repair.status] ?? [];

  const handleAdvance = (to) => {
    onAdvance({ status: to, statusNote: note || undefined });
    setNote('');
    setPendingTransition(null);
  };

  if (transitions.length === 0 && !canCancel) return null;

  return (
    <div className="mt-8 border-t border-[#E2E8F0] pt-6">
      <p className="text-[11px] text-[#94A3B8] uppercase tracking-wider mb-4">Avanzar estado</p>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Nota para el cambio de estado (opcional)..."
        rows={2}
        className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
          placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all resize-none mb-4"
      />

      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <button
            key={t.to}
            onClick={() => handleAdvance(t.to)}
            disabled={isLoading}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-40 ${
              t.primary
                ? 'bg-[#3B82F6] hover:bg-[#2563EB] text-white'
                : 'bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B]'
            }`}
          >
            {isLoading ? '...' : t.label}
          </button>
        ))}

        {canCancel && !['DELIVERED', 'CANCELLED'].includes(repair.status) && (
          <>
            {pendingTransition !== 'CANCELLED' ? (
              <button
                onClick={() => setPendingTransition('CANCELLED')}
                className="px-4 py-2 rounded-lg text-[13px] text-red-400 hover:text-red-500 transition-colors ml-auto"
              >
                Cancelar orden
              </button>
            ) : (
              <div className="flex items-center gap-3 ml-auto">
                <span className="text-[12px] text-[#64748B]">¿Confirmás la cancelación?</span>
                <button
                  onClick={() => handleAdvance('CANCELLED')}
                  disabled={isLoading}
                  className="text-[12px] text-red-500 hover:text-red-600 font-medium transition-colors"
                >
                  Sí, cancelar
                </button>
                <button
                  onClick={() => setPendingTransition(null)}
                  className="text-[12px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
                >
                  No
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Info Row ─────────────────────────────────────────────────────────────────

const Row = ({ label, children }) => (
  <div className="flex justify-between items-start py-3 border-b border-[#E2E8F0] last:border-0">
    <span className="text-[12px] text-[#94A3B8] uppercase tracking-wider shrink-0 mr-4">{label}</span>
    <span className="text-[13px] text-[#0F172A] text-right">{children ?? '—'}</span>
  </div>
);

// ─── Main ─────────────────────────────────────────────────────────────────────

const RepairsDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = ['OWNER', 'ADMIN'].includes(user?.role);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});

  const { data: repair, isLoading, isError } = useQuery({
    queryKey: ['repair', id],
    queryFn: () => api.get(`/repairs/${id}`).then((r) => r.data),
  });

  const { data: techData } = useQuery({
    queryKey: ['repairs-technicians'],
    queryFn: () => api.get('/repairs/technicians').then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled: canEdit,
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.put(`/repairs/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair', id] });
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
      queryClient.invalidateQueries({ queryKey: ['repairs-stats'] });
      setIsEditing(false);
    },
  });

  const startEdit = () => {
    setEditForm({
      technicianId: repair.technicianId ?? '',
      budget: repair.budget ?? '',
      estimatedDate: repair.estimatedDate ? repair.estimatedDate.split('T')[0] : '',
      internalNotes: repair.internalNotes ?? '',
      faultDescription: repair.faultDescription,
    });
    setIsEditing(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 rounded-full border-2 border-[#E2E8F0] border-t-[#3B82F6] animate-spin" />
      </div>
    );
  }

  if (isError || !repair) {
    return (
      <div className="px-6 pt-12 text-center text-[#94A3B8] text-[13px]">
        <p>Orden no encontrada.</p>
        <Link to="/repairs" className="text-[#3B82F6] hover:underline mt-2 block">Volver a reparaciones</Link>
      </div>
    );
  }

  return (
    <div className="px-6 pt-8 pb-16 max-w-xl mx-auto">

      <div className="flex items-center gap-3 mb-8">
        <Link to="/repairs" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Reparaciones</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="font-mono text-[12px] text-[#64748B]">ORD-{refId(repair.id)}</span>
      </div>

      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] text-[#94A3B8] font-mono mb-1">ORD-{refId(repair.id)}</p>
            <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">{repair.customerName}</h1>
            <p className="text-[14px] text-[#64748B] mt-1">{repair.deviceModel}{repair.deviceColor ? ` · ${repair.deviceColor}` : ''}</p>
          </div>
          <StatusBadge status={repair.status} size="lg" />
        </div>
      </div>

      <div className="border border-[#E2E8F0] rounded-xl px-5 mb-5 bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <Row label="Cliente">{repair.customerName}</Row>
        <Row label="Teléfono">{repair.customerPhone}</Row>
        <Row label="Equipo">{repair.deviceModel}</Row>
        {repair.deviceImei && <Row label="IMEI"><span className="font-mono">{repair.deviceImei}</span></Row>}
        <Row label="Tipo de falla">{FAULT_LABELS[repair.faultType]}</Row>
        <Row label="Descripción">{repair.faultDescription}</Row>
        <Row label="Técnico">{repair.technician?.name}</Row>
        <Row label="Presupuesto">{formatCurrency(repair.budget)}</Row>
        <Row label="Entrega estimada">{formatDate(repair.estimatedDate)}</Row>
        {repair.readyAt && <Row label="Listo el">{formatDate(repair.readyAt)}</Row>}
        {repair.deliveredAt && <Row label="Entregado el">{formatDate(repair.deliveredAt)}</Row>}
        {repair.internalNotes && <Row label="Notas">{repair.internalNotes}</Row>}
      </div>

      {canEdit && !isEditing && (
        <button
          onClick={startEdit}
          className="mb-5 text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
        >
          Editar datos →
        </button>
      )}

      {isEditing && (
        <div className="border border-[#3B82F6]/30 rounded-xl p-5 mb-5 bg-[#EFF6FF]/40">
          <p className="text-[11px] text-[#3B82F6] font-medium uppercase tracking-wider mb-4">Editar orden</p>
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Técnico</label>
              <select
                value={editForm.technicianId}
                onChange={(e) => setEditForm((p) => ({ ...p, technicianId: e.target.value }))}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#64748B] focus:outline-none focus:border-[#3B82F6]"
              >
                <option value="">Sin asignar</option>
                {techData?.technicians?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Presupuesto</label>
                <input
                  type="number"
                  value={editForm.budget}
                  onChange={(e) => setEditForm((p) => ({ ...p, budget: e.target.value }))}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#3B82F6]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Entrega estimada</label>
                <input
                  type="date"
                  value={editForm.estimatedDate}
                  onChange={(e) => setEditForm((p) => ({ ...p, estimatedDate: e.target.value }))}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#3B82F6]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Descripción de la falla</label>
              <textarea
                value={editForm.faultDescription}
                onChange={(e) => setEditForm((p) => ({ ...p, faultDescription: e.target.value }))}
                rows={2}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#3B82F6] resize-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Notas internas</label>
              <textarea
                value={editForm.internalNotes}
                onChange={(e) => setEditForm((p) => ({ ...p, internalNotes: e.target.value }))}
                rows={2}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#3B82F6] resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => updateMutation.mutate(editForm)}
                disabled={updateMutation.isPending}
                className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-40"
              >
                {updateMutation.isPending ? 'Guardando...' : 'Guardar'}
              </button>
              <button onClick={() => setIsEditing(false)} className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {repair.statusHistory?.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] text-[#94A3B8] uppercase tracking-wider mb-5">Historial</p>
          <Timeline history={repair.statusHistory} />
        </div>
      )}

      <AdvancePanel
        repair={repair}
        onAdvance={(data) => updateMutation.mutate(data)}
        isLoading={updateMutation.isPending}
      />

      <div className="mt-10 border-t border-[#E2E8F0] pt-5">
        <p className="text-[12px] text-[#CBD5E1]">
          Creada el {formatDateTime(repair.createdAt)}
        </p>
      </div>
    </div>
  );
};

export default RepairsDetail;

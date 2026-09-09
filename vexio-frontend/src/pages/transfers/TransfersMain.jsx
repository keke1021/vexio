import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import NewTransferModal from './NewTransferModal';

// OWNER/ADMIN/SELLER: acceso total (todas las sucursales, listado completo).
// TECH no entra a este módulo. `branchLocked` quedó, en la práctica, inerte.
const UNRESTRICTED_ROLES = ['OWNER', 'ADMIN', 'SELLER', 'SUPERADMIN'];

const STATUS_BADGE = {
  OPEN:       { label: 'Abierto',   cls: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]' },
  DISPATCHED: { label: 'En camino', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
  CLOSED:     { label: 'Cerrado',   cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const StatusBadge = ({ status }) => {
  const cfg = STATUS_BADGE[status] ?? { label: status, cls: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const LotRow = ({ transfer, tiendaId }) => {
  const isOutgoing = transfer.fromTienda.id === tiendaId;
  const other = isOutgoing ? transfer.toTienda : transfer.fromTienda;
  const summary = transfer.itemsSummary ?? {};
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  const resolved = (summary.RECEIVED ?? 0) + (summary.CANCELLED ?? 0);

  return (
    <Link
      to={`/transfers/${transfer.id}`}
      className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0] last:border-0 hover:bg-[#F8FAFC] transition-colors"
    >
      <div>
        <p className="text-[13px] text-[#0F172A] font-medium">
          {isOutgoing ? `Hacia ${other.name}` : `Desde ${other.name}`}
        </p>
        <p className="text-[11px] text-[#475569] mt-0.5">
          {total} equipo{total !== 1 ? 's' : ''} · {resolved}/{total} resuelto{resolved !== 1 ? 's' : ''} · {fmtDate(transfer.createdAt)}
        </p>
      </div>
      <StatusBadge status={transfer.status} />
    </Link>
  );
};

const Section = ({ title, titleCls, transfers, tiendaId, hint }) => (
  <div className="mb-6">
    <p className={`text-[11px] uppercase tracking-widest font-medium mb-3 ${titleCls}`}>{title}</p>
    <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      {transfers.map((t) => <LotRow key={t.id} transfer={t} tiendaId={tiendaId} />)}
    </div>
    {hint && <p className="text-[11px] text-[#475569] mt-2">{hint}</p>}
  </div>
);

// Hub del módulo: agrupa las transferencias que tocan la sucursal
// seleccionada en tres baldes (por recibir, en armado, enviadas
// esperando confirmación) + historial de las ya cerradas. Sumar ítems a un
// lote se hace desde la ficha del equipo en Inventario (SendToTiendaPanel),
// no desde acá — evita duplicar el buscador de equipos en dos pantallas.
const TransfersMain = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showNewTransfer, setShowNewTransfer] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // SELLER/TECH solo operan su sucursal asignada (el backend los limita con
  // assertTiendaAccess). Reducimos el selector a esa sucursal así no eligen
  // una ajena y se comen un 403 / una pantalla vacía engañosa.
  const branchLocked = user && !UNRESTRICTED_ROLES.includes(user.role);
  const allTiendas = tiendasData?.tiendas ?? [];
  const tiendas = branchLocked ? allTiendas.filter((t) => t.id === user.tiendaId) : allTiendas;

  const tiendaIdParam = searchParams.get('tiendaId') || '';
  const tiendaId = branchLocked
    ? (tiendas[0]?.id || '')
    : (tiendaIdParam || (tiendas.length === 1 ? tiendas[0].id : ''));

  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfers', tiendaId],
    queryFn: () => api.get('/stock-transfers', { params: { tiendaId, pageSize: 100 } }).then((r) => r.data),
    enabled: !!tiendaId,
    staleTime: 15_000,
  });

  const transfers = data?.transfers ?? [];
  const incomingDispatched = transfers.filter((t) => t.status === 'DISPATCHED' && t.toTienda.id === tiendaId);
  const outgoingOpen       = transfers.filter((t) => t.status === 'OPEN' && t.fromTienda.id === tiendaId);
  const outgoingDispatched = transfers.filter((t) => t.status === 'DISPATCHED' && t.fromTienda.id === tiendaId);
  const history            = transfers.filter((t) => t.status === 'CLOSED');
  const noActive = incomingDispatched.length === 0 && outgoingOpen.length === 0 && outgoingDispatched.length === 0;

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Transferencias</h1>
          {tiendas.length > 1 && (
            <div className="mt-1.5">
              <label className="text-[10px] text-[#475569] uppercase tracking-[0.12em] mr-2">Sucursal</label>
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
        </div>
        {tiendaId && (
          <button
            onClick={() => setShowNewTransfer(true)}
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Nueva transferencia
          </button>
        )}
      </div>

      {allTiendas.length < 2 && (
        <p className="text-[13px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Hace falta al menos dos sucursales para transferir stock entre ellas.
        </p>
      )}

      {branchLocked && allTiendas.length >= 2 && !tiendaId && (
        <p className="text-[13px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Tu usuario no tiene una sucursal asignada — pedile a un encargado que te asigne una para operar transferencias.
        </p>
      )}

      {tiendas.length > 1 && !tiendaId && (
        <p className="text-[13px] text-[#475569]">Elegí una sucursal arriba para ver sus transferencias.</p>
      )}

      {tiendaId && isLoading && <p className="text-[#64748B] text-[13px]">Cargando...</p>}

      {tiendaId && !isLoading && (
        <>
          {incomingDispatched.length > 0 && (
            <Section title="Por recibir" titleCls="text-amber-600" transfers={incomingDispatched} tiendaId={tiendaId} />
          )}
          {outgoingOpen.length > 0 && (
            <Section
              title="Lotes en armado"
              titleCls="text-[#3B82F6]"
              transfers={outgoingOpen}
              tiendaId={tiendaId}
              hint='Para sumar más equipos, usá "+ Nueva transferencia" arriba o "Enviar a otra sucursal" desde la ficha del equipo en Inventario.'
            />
          )}
          {outgoingDispatched.length > 0 && (
            <Section title="Enviados, esperando confirmación" titleCls="text-[#475569]" transfers={outgoingDispatched} tiendaId={tiendaId} />
          )}
          {noActive && (
            <p className="text-[13px] text-[#475569] mb-6">No hay transferencias activas en esta sucursal.</p>
          )}

          <div className="mt-10">
            <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-3">Historial</p>
            {history.length === 0 ? (
              <p className="text-[13px] text-[#475569]">Sin transferencias cerradas todavía.</p>
            ) : (
              <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {history.map((t) => <LotRow key={t.id} transfer={t} tiendaId={tiendaId} />)}
              </div>
            )}
          </div>
        </>
      )}

      {showNewTransfer && (
        <NewTransferModal
          fromTiendaId={tiendaId}
          tiendas={tiendas}
          onClose={(transferId) => {
            setShowNewTransfer(false);
            queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
            if (transferId) navigate(`/transfers/${transferId}`);
          }}
        />
      )}
    </div>
  );
};

export default TransfersMain;

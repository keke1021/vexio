import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

export const STATUS_CONFIG = {
  RECEIVED:      { label: 'Recibido',            cls: 'text-[#64748B] bg-[#F1F5F9]' },
  DIAGNOSING:    { label: 'Diagnóstico',          cls: 'text-[#3B82F6] bg-[#EFF6FF]' },
  IN_PROGRESS:   { label: 'En reparación',        cls: 'text-[#60A5FA] bg-[#EFF6FF]' },
  WAITING_PARTS: { label: 'Esperando repuestos',  cls: 'text-orange-500 bg-orange-50' },
  READY:         { label: 'Listo para entregar',  cls: 'text-emerald-600 bg-emerald-50 ring-1 ring-emerald-200' },
  DELIVERED:     { label: 'Entregado',            cls: 'text-[#94A3B8] bg-[#F8FAFC]' },
  CANCELLED:     { label: 'Cancelado',            cls: 'text-red-400 bg-red-50' },
};

export const FAULT_LABELS = {
  SCREEN:   'Pantalla',
  BATTERY:  'Batería',
  CHARGING: 'Puerto de carga',
  CAMERA:   'Cámara',
  SPEAKER:  'Altavoz / Micrófono',
  BUTTON:   'Botones',
  WATER:    'Daño por agua',
  SOFTWARE: 'Software / Reset',
  OTHER:    'Otro',
};

const STATUS_TABS = [
  { value: '', label: 'Todas' },
  { value: 'RECEIVED',      label: 'Recibidas' },
  { value: 'DIAGNOSING',    label: 'Diagnóstico' },
  { value: 'IN_PROGRESS',   label: 'En reparación' },
  { value: 'WAITING_PARTS', label: 'Esperando' },
  { value: 'READY',         label: 'Listas' },
  { value: 'DELIVERED',     label: 'Entregadas' },
];

const formatDate = (d) => d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—';
const refId = (id) => id.slice(-5).toUpperCase();

export const StatusBadge = ({ status, size = 'sm' }) => {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'text-[#64748B] bg-[#F1F5F9]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-medium ${
      size === 'lg' ? 'text-[13px]' : 'text-[11px]'
    } ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const RepairsList = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canWrite = ['OWNER', 'ADMIN', 'TECH'].includes(user?.role);

  const [statusFilter, setStatusFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['repairs', statusFilter, techFilter, search],
    queryFn: () =>
      api.get('/repairs', {
        params: {
          status: statusFilter || undefined,
          technicianId: techFilter || undefined,
          search: search || undefined,
        },
      }).then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: techData } = useQuery({
    queryKey: ['repairs-technicians'],
    queryFn: () => api.get('/repairs/technicians').then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled: ['OWNER', 'ADMIN'].includes(user?.role),
  });

  const repairs = data?.repairs ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="px-6 pt-8 pb-16 max-w-[1100px] mx-auto">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Reparaciones</h1>
          <p className="text-[13px] text-[#94A3B8] mt-0.5">
            {isLoading ? '...' : `${total} orden${total !== 1 ? 'es' : ''}`}
          </p>
        </div>
        {canWrite && (
          <Link
            to="/repairs/new"
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Nueva orden
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-[#EFF6FF] text-[#3B82F6]'
                : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          placeholder="Buscar cliente, teléfono o equipo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
            placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-colors w-64"
        />
        {['OWNER', 'ADMIN'].includes(user?.role) && (
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
              focus:outline-none focus:border-[#3B82F6] transition-colors"
          >
            <option value="">Todos los técnicos</option>
            {techData?.technicians?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">#</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Cliente</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Equipo</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Falla</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Estado</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Técnico</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Presupuesto</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden xl:table-cell">Entrega est.</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="text-center py-16 text-[#CBD5E1]">Cargando...</td></tr>
            )}
            {isError && (
              <tr><td colSpan={8} className="text-center py-16 text-red-400">Error al cargar las órdenes.</td></tr>
            )}
            {!isLoading && !isError && repairs.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-[#CBD5E1]">
                  No hay órdenes{statusFilter ? ` con estado "${STATUS_CONFIG[statusFilter]?.label}"` : ''}.
                </td>
              </tr>
            )}
            {repairs.map((r) => (
              <tr
                key={r.id}
                onClick={() => navigate(`/repairs/${r.id}`)}
                className="border-b border-[#E2E8F0] hover:bg-[#EFF6FF] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3.5 font-mono text-[11px] text-[#94A3B8]">{refId(r.id)}</td>
                <td className="px-4 py-3.5">
                  <p className="text-[#0F172A] font-medium">{r.customerName}</p>
                  <p className="text-[#94A3B8] text-[11px]">{r.customerPhone}</p>
                </td>
                <td className="px-4 py-3.5 text-[#64748B] hidden sm:table-cell">{r.deviceModel}</td>
                <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">{FAULT_LABELS[r.faultType]}</td>
                <td className="px-4 py-3.5"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3.5 text-[#94A3B8] hidden lg:table-cell">{r.technician?.name ?? '—'}</td>
                <td className="px-4 py-3.5 text-right text-[#64748B] hidden lg:table-cell">
                  {r.budget != null
                    ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(r.budget)
                    : '—'}
                </td>
                <td className="px-4 py-3.5 text-[#94A3B8] hidden xl:table-cell">{formatDate(r.estimatedDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RepairsList;

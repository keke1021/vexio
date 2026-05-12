import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';

const STATUS_CONFIG = {
  ABIERTO:    { label: 'Abierto',     cls: 'text-[#3B82F6] bg-[#EFF6FF]' },
  EN_PROCESO: { label: 'En proceso',  cls: 'text-amber-600 bg-amber-50' },
  RESUELTO:   { label: 'Resuelto',    cls: 'text-emerald-600 bg-emerald-50' },
};

const PRIORITY_CONFIG = {
  BAJA:  { label: 'Baja',  cls: 'text-[#94A3B8]' },
  MEDIA: { label: 'Media', cls: 'text-amber-600' },
  ALTA:  { label: 'Alta',  cls: 'text-red-500' },
};

const CATEGORY_LABELS = {
  ERROR_SISTEMA:     'Error del sistema',
  CONSULTA_GENERAL:  'Consulta general',
  PROBLEMA_MODULO:   'Problema en módulo',
  SUGERENCIA:        'Sugerencia',
  FACTURACION:       'Facturación',
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

const Badge = ({ config, value }) => {
  const cfg = config[value] ?? { label: value, cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const TicketsList = () => {
  const [status,   setStatus]   = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', status, category, priority],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status)   params.set('status', status);
      if (category) params.set('category', category);
      if (priority) params.set('priority', priority);
      return api.get(`/tickets?${params}`).then((r) => r.data);
    },
    staleTime: 30_000,
  });

  const tickets = data?.tickets ?? [];

  const selectCls = 'bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[12px] text-[#64748B] focus:outline-none focus:border-[#3B82F6] transition-colors';

  return (
    <div className="px-6 pt-8 pb-16 max-w-[860px] mx-auto">

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Soporte</h1>
          <p className="text-[13px] text-[#94A3B8] mt-1">Tus tickets de soporte técnico.</p>
        </div>
        <Link
          to="/tickets/new"
          className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nuevo ticket
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="">Todos los estados</option>
          <option value="ABIERTO">Abierto</option>
          <option value="EN_PROCESO">En proceso</option>
          <option value="RESUELTO">Resuelto</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
          <option value="">Todas las categorías</option>
          {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectCls}>
          <option value="">Todas las prioridades</option>
          <option value="BAJA">Baja</option>
          <option value="MEDIA">Media</option>
          <option value="ALTA">Alta</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-[#CBD5E1] text-[13px]">Cargando...</p>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#CBD5E1] text-[14px]">No hay tickets.</p>
          <Link to="/tickets/new" className="text-[13px] text-[#3B82F6] hover:text-[#2563EB] mt-3 inline-block transition-colors">
            Crear el primero →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <Link
              key={t.id}
              to={`/tickets/${t.id}`}
              className="block bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 hover:border-[#3B82F6]/30 hover:bg-[#EFF6FF] transition-colors"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-[#0F172A] truncate">{t.title}</p>
                  <p className="text-[12px] text-[#94A3B8] mt-0.5">
                    {CATEGORY_LABELS[t.category] ?? t.category}
                    {t._count?.replies > 0 && (
                      <span className="ml-2 text-[#3B82F6]">· {t._count.replies} respuesta{t._count.replies !== 1 ? 's' : ''}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-medium ${PRIORITY_CONFIG[t.priority]?.cls ?? 'text-[#94A3B8]'}`}>
                    {PRIORITY_CONFIG[t.priority]?.label ?? t.priority}
                  </span>
                  <Badge config={STATUS_CONFIG} value={t.status} />
                </div>
              </div>
              <p className="text-[11px] text-[#CBD5E1] mt-2">{fmtDate(t.createdAt)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default TicketsList;

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const STATUS_CONFIG = {
  ABIERTO:    { label: 'Abierto',    cls: 'text-[#3B82F6] bg-[#EFF6FF]' },
  EN_PROCESO: { label: 'En proceso', cls: 'text-amber-600 bg-amber-50' },
  RESUELTO:   { label: 'Resuelto',   cls: 'text-emerald-600 bg-emerald-50' },
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

const fmtTime = (d) =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

const BACKEND_URL = import.meta.env.VITE_API_URL?.replace('/api', '') ?? 'http://localhost:3001';

const Badge = ({ config, value }) => {
  const cfg = config[value] ?? { label: value, cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const TicketPanel = ({ ticketId, onClose }) => {
  const queryClient  = useQueryClient();
  const fileInputRef = useRef(null);

  const [reply,      setReply]      = useState('');
  const [replyFiles, setReplyFiles] = useState([]);
  const [err,        setErr]        = useState('');

  const { data: ticket } = useQuery({
    queryKey: ['admin-ticket', ticketId],
    queryFn: () => api.get(`/admin/tickets/${ticketId}`).then((r) => r.data),
    staleTime: 15_000,
    enabled: !!ticketId,
  });

  const replyMutation = useMutation({
    mutationFn: (fd) => api.post(`/tickets/${ticketId}/reply`, fd).then((r) => r.data),
    onSuccess: () => {
      setReply('');
      setReplyFiles([]);
      queryClient.invalidateQueries({ queryKey: ['admin-ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
    },
    onError: (e) => setErr(e.response?.data?.message || 'Error.'),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => api.put(`/tickets/${ticketId}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
    },
    onError: (e) => setErr(e.response?.data?.message || 'Error.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setErr('');
    if (!reply.trim()) return;
    const fd = new FormData();
    fd.append('message', reply.trim());
    replyFiles.forEach((f) => fd.append('attachments', f));
    replyMutation.mutate(fd);
  };

  if (!ticket) return (
    <div className="flex items-center justify-center h-40 text-[#CBD5E1] text-[13px]">Cargando...</div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between px-5 py-4 border-b border-[#E2E8F0] dark:border-[#334155]">
        <div className="min-w-0 pr-4">
          <p className="text-[14px] font-semibold text-[#0F172A] dark:text-[#F1F5F9] leading-snug">{ticket.title}</p>
          <p className="text-[11px] text-[#94A3B8] mt-0.5">{ticket.tenant?.name} · {CATEGORY_LABELS[ticket.category] ?? ticket.category}</p>
        </div>
        <button onClick={onClose} className="text-[#CBD5E1] hover:text-[#94A3B8] text-[18px] leading-none transition-colors shrink-0">×</button>
      </div>

      <div className="flex items-center gap-2 px-5 py-3 border-b border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]">
        <Badge config={STATUS_CONFIG} value={ticket.status} />
        <span className={`text-[11px] font-medium ${PRIORITY_CONFIG[ticket.priority]?.cls ?? 'text-[#94A3B8]'}`}>
          {PRIORITY_CONFIG[ticket.priority]?.label ?? ticket.priority}
        </span>
        {ticket.status !== 'RESUELTO' && (
          <div className="ml-auto flex items-center gap-1.5">
            {ticket.status === 'ABIERTO' && (
              <button
                onClick={() => statusMutation.mutate('EN_PROCESO')}
                disabled={statusMutation.isPending}
                className="text-[11px] text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
              >
                En proceso
              </button>
            )}
            <button
              onClick={() => statusMutation.mutate('RESUELTO')}
              disabled={statusMutation.isPending}
              className="text-[11px] text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
            >
              Resolver
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div className="bg-[#F8FAFC] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155] rounded-xl px-4 py-3">
          <div className="flex justify-between mb-1.5">
            <span className="text-[12px] font-medium text-[#64748B] dark:text-[#94A3B8]">{ticket.user?.name}</span>
            <span className="text-[11px] text-[#CBD5E1] dark:text-[#475569]">{fmtTime(ticket.createdAt)}</span>
          </div>
          <p className="text-[13px] text-[#0F172A] dark:text-[#F1F5F9] whitespace-pre-wrap">{ticket.description}</p>
          {ticket.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {ticket.attachments.map((a, i) => (
                <a key={i} href={`${BACKEND_URL}/${a}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-[#3B82F6] hover:text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded transition-colors">
                  Img {i + 1}
                </a>
              ))}
            </div>
          )}
        </div>

        {ticket.replies?.map((r) => (
          <div
            key={r.id}
            className={`rounded-xl px-4 py-3 ${
              r.isAdmin
                ? 'bg-[#EFF6FF] dark:bg-[#1E3A5F] border border-[#3B82F6]/20 ml-3'
                : 'bg-[#F8FAFC] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155]'
            }`}
          >
            <div className="flex justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-[#64748B] dark:text-[#94A3B8]">{r.user?.name}</span>
                {r.isAdmin && (
                  <span className="text-[10px] font-medium text-[#3B82F6] bg-[#3B82F6]/10 px-1.5 py-0.5 rounded">Soporte</span>
                )}
              </div>
              <span className="text-[11px] text-[#CBD5E1] dark:text-[#475569]">{fmtTime(r.createdAt)}</span>
            </div>
            <p className="text-[13px] text-[#0F172A] dark:text-[#F1F5F9] whitespace-pre-wrap">{r.message}</p>
          </div>
        ))}
      </div>

      {ticket.status !== 'RESUELTO' && (
        <form onSubmit={handleSubmit} className="px-5 py-4 border-t border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B]">
          <textarea
            rows={3}
            placeholder="Responder..."
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            className="bg-transparent border border-[#E2E8F0] dark:border-[#334155] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] dark:text-[#F1F5F9]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-colors w-full resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                const sel = Array.from(e.target.files).filter((f) => f.type.startsWith('image/') && f.size <= 2 * 1024 * 1024);
                setReplyFiles((p) => [...p, ...sel].slice(0, 3));
              }} />
              {replyFiles.length < 3 && (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[11px] text-[#94A3B8] hover:text-[#64748B] transition-colors">
                  + Img
                </button>
              )}
              {replyFiles.map((f, i) => (
                <span key={i} className="text-[10px] text-[#64748B]">
                  {f.name.slice(0, 10)}…
                  <button type="button" onClick={() => setReplyFiles((p) => p.filter((_, idx) => idx !== i))} className="ml-1 text-[#94A3B8] hover:text-red-400">×</button>
                </span>
              ))}
            </div>
            <button
              type="submit"
              disabled={replyMutation.isPending || !reply.trim()}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[12px] font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              {replyMutation.isPending ? '...' : 'Enviar'}
            </button>
          </div>
          {err && <p className="text-[11px] text-red-500 mt-2">{err}</p>}
        </form>
      )}
    </div>
  );
};

const AdminTickets = () => {
  const [status,   setStatus]   = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [selected, setSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tickets', status, category, priority],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status)   params.set('status', status);
      if (category) params.set('category', category);
      if (priority) params.set('priority', priority);
      return api.get(`/admin/tickets?${params}`).then((r) => r.data);
    },
    staleTime: 30_000,
  });

  const tickets = data?.tickets ?? [];

  const selectCls = 'bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[12px] text-[#64748B] focus:outline-none focus:border-[#3B82F6] transition-colors';

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className={`flex flex-col ${selected ? 'w-1/2 border-r border-[#E2E8F0]' : 'w-full'} overflow-hidden`}>
        <div className="px-6 pt-8 pb-4 shrink-0">
          <div className="flex items-center gap-3 mb-6 text-[13px]">
            <Link to="/admin" className="text-[#94A3B8] hover:text-[#64748B] transition-colors">← Tiendas</Link>
            <span className="text-[#E2E8F0]">/</span>
            <span className="text-[#64748B]">Tickets de soporte</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mb-5">Tickets</h1>
          <div className="flex flex-wrap gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
              <option value="">Todos los estados</option>
              <option value="ABIERTO">Abierto</option>
              <option value="EN_PROCESO">En proceso</option>
              <option value="RESUELTO">Resuelto</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
              <option value="">Todas las categorías</option>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectCls}>
              <option value="">Todas las prioridades</option>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Media</option>
              <option value="BAJA">Baja</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8 dark:bg-[#0F172A]">
          {isLoading ? (
            <p className="text-[#CBD5E1] text-[13px]">Cargando...</p>
          ) : tickets.length === 0 ? (
            <p className="text-[#CBD5E1] text-[13px] py-8 text-center">Sin tickets.</p>
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelected(selected === t.id ? null : t.id)}
                  className={`w-full text-left border rounded-xl px-5 py-4 transition-colors ${
                    selected === t.id
                      ? 'border-violet-300 bg-violet-50 dark:bg-[#1E3A5F] dark:border-[#3B82F6]/50'
                      : 'border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] hover:border-[#3B82F6]/30 hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]/50'
                  }`}
                  style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[#0F172A] dark:text-[#F1F5F9] truncate">{t.title}</p>
                      <p className="text-[11px] text-[#94A3B8] dark:text-[#64748B] mt-0.5">
                        {t.tenant?.name} · {CATEGORY_LABELS[t.category] ?? t.category}
                        {t._count?.replies > 0 && <span className="ml-1.5 text-violet-500">· {t._count.replies}r</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge config={STATUS_CONFIG} value={t.status} />
                      <span className={`text-[10px] font-medium ${PRIORITY_CONFIG[t.priority]?.cls ?? 'text-[#94A3B8]'}`}>
                        {PRIORITY_CONFIG[t.priority]?.label}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#CBD5E1] dark:text-[#475569] mt-1.5">{fmtTime(t.createdAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="w-1/2 overflow-hidden flex flex-col bg-white dark:bg-[#1E293B] border-l border-[#E2E8F0] dark:border-[#334155]">
          <TicketPanel ticketId={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
};

export default AdminTickets;

import { useRef, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import api, { tokenStore } from '../../api/axios';

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

const TicketDetail = () => {
  const { id }          = useParams();
  const { user }        = useAuth();
  const queryClient     = useQueryClient();
  const bottomRef       = useRef(null);
  const fileInputRef    = useRef(null);

  const [reply,      setReply]      = useState('');
  const [replyFiles, setReplyFiles] = useState([]);
  const [error,      setError]      = useState('');

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get(`/tickets/${id}`).then((r) => r.data),
    staleTime: 15_000,
  });

  // SSE: actualización instantánea cuando el otro lado envía una reply
  useEffect(() => {
    const token = tokenStore.getAccessToken();
    if (!token) return;

    const es = new EventSource(
      `${api.defaults.baseURL}/tickets/${id}/stream?token=${encodeURIComponent(token)}`
    );

    es.addEventListener('reply', () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    });

    return () => es.close();
  }, [id, queryClient, user]);

  const replyMutation = useMutation({
    mutationFn: (fd) => api.post(`/tickets/${id}/reply`, fd).then((r) => r.data),
    onSuccess: () => {
      setReply('');
      setReplyFiles([]);
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al enviar la respuesta.'),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => api.put(`/tickets/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ticket', id] }),
    onError: (err) => setError(err.response?.data?.message || 'Error al actualizar el estado.'),
  });

  const handleReplyFiles = (e) => {
    const selected = Array.from(e.target.files).filter((f) => f.type.startsWith('image/') && f.size <= 2 * 1024 * 1024);
    setReplyFiles((prev) => [...prev, ...selected].slice(0, 3));
  };

  const handleReplySubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!reply.trim()) return;
    const fd = new FormData();
    fd.append('message', reply.trim());
    replyFiles.forEach((f) => fd.append('attachments', f));
    replyMutation.mutate(fd);
  };

  if (isLoading) return <div className="px-6 pt-8 text-[#CBD5E1] text-[13px]">Cargando...</div>;
  if (!ticket) return (
    <div className="px-6 pt-8">
      <p className="text-[#94A3B8] text-[13px]">Ticket no encontrado.</p>
      <Link to="/tickets" className="text-[#3B82F6] text-[13px] mt-2 inline-block">← Volver</Link>
    </div>
  );

  const statusCfg   = STATUS_CONFIG[ticket.status]    ?? { label: ticket.status, cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  const priorityCfg = PRIORITY_CONFIG[ticket.priority] ?? { label: ticket.priority, cls: 'text-[#94A3B8]' };
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const canReply     = ticket.status !== 'RESUELTO';

  return (
    <div className="max-w-[760px] mx-auto px-6 pt-8 pb-24">

      <div className="flex items-center gap-2 mb-8 text-[13px]">
        <Link to="/tickets" className="text-[#94A3B8] hover:text-[#64748B] transition-colors">← Soporte</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[#64748B] truncate">{ticket.title}</span>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-5 mb-6"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="text-[18px] font-bold tracking-tight text-[#0F172A]">{ticket.title}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 ${statusCfg.cls}`}>
            {statusCfg.label}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#94A3B8]">
          <span>{CATEGORY_LABELS[ticket.category] ?? ticket.category}</span>
          <span className={priorityCfg.cls}>Prioridad {priorityCfg.label}</span>
          {isSuperAdmin && ticket.tenant && (
            <span className="text-violet-500">{ticket.tenant.name}</span>
          )}
          <span>{fmtTime(ticket.createdAt)}</span>
        </div>

        {ticket.status !== 'RESUELTO' && isSuperAdmin && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[#E2E8F0]">
            <span className="text-[11px] text-[#94A3B8] uppercase tracking-widest">Estado</span>
            {ticket.status === 'ABIERTO' && (
              <button
                onClick={() => statusMutation.mutate('EN_PROCESO')}
                disabled={statusMutation.isPending}
                className="text-[12px] text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1 rounded-lg transition-colors disabled:opacity-40"
              >
                Marcar en proceso
              </button>
            )}
            <button
              onClick={() => statusMutation.mutate('RESUELTO')}
              disabled={statusMutation.isPending}
              className="text-[12px] text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1 rounded-lg transition-colors disabled:opacity-40"
            >
              Marcar resuelto
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 mb-6">
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-[#64748B]">{ticket.user?.name ?? 'Usuario'}</span>
            <span className="text-[11px] text-[#CBD5E1]">{fmtTime(ticket.createdAt)}</span>
          </div>
          <p className="text-[13px] text-[#0F172A] whitespace-pre-wrap">{ticket.description}</p>
          {ticket.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {ticket.attachments.map((a, i) => (
                <a key={i} href={`${BACKEND_URL}/${a}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-[#3B82F6] hover:text-[#2563EB] bg-[#EFF6FF] px-2 py-1 rounded transition-colors">
                  Imagen {i + 1}
                </a>
              ))}
            </div>
          )}
        </div>

        {ticket.replies?.map((r) => (
          <div
            key={r.id}
            className={`rounded-xl px-5 py-4 ${
              r.isAdmin
                ? 'bg-[#EFF6FF] border border-[#3B82F6]/20 ml-4'
                : 'bg-[#F8FAFC] border border-[#E2E8F0]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-[#64748B]">{r.user?.name ?? '—'}</span>
                {r.isAdmin && (
                  <span className="text-[10px] font-medium text-[#3B82F6] bg-[#3B82F6]/10 px-1.5 py-0.5 rounded">
                    Soporte
                  </span>
                )}
              </div>
              <span className="text-[11px] text-[#CBD5E1]">{fmtTime(r.createdAt)}</span>
            </div>
            <p className="text-[13px] text-[#0F172A] whitespace-pre-wrap">{r.message}</p>
            {r.attachments?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {r.attachments.map((a, i) => (
                  <a key={i} href={`${BACKEND_URL}/${a}`} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-[#3B82F6] hover:text-[#2563EB] bg-[#EFF6FF] px-2 py-1 rounded transition-colors">
                    Imagen {i + 1}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {canReply ? (
        <form onSubmit={handleReplySubmit} className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <textarea
            rows={4}
            placeholder="Escribí tu respuesta..."
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className="bg-transparent text-[13px] text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none w-full resize-none"
          />
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#E2E8F0]">
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleReplyFiles} />
              {replyFiles.length < 3 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
                >
                  + Adjuntar imagen
                </button>
              )}
              {replyFiles.map((f, i) => (
                <span key={i} className="text-[11px] text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 rounded flex items-center gap-1">
                  {f.name.slice(0, 15)}…
                  <button type="button" onClick={() => setReplyFiles((p) => p.filter((_, idx) => idx !== i))} className="text-[#94A3B8] hover:text-red-400">×</button>
                </span>
              ))}
            </div>
            <button
              type="submit"
              disabled={replyMutation.isPending || !reply.trim()}
              className="bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-40 text-white text-[12px] font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              {replyMutation.isPending ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </form>
      ) : (
        <div className="text-center py-6 bg-emerald-50 border border-emerald-200 rounded-xl">
          <p className="text-[13px] text-emerald-600">Ticket resuelto.</p>
        </div>
      )}

      {error && (
        <p className="text-[12px] text-red-500 mt-3">{error}</p>
      )}
    </div>
  );
};

export default TicketDetail;

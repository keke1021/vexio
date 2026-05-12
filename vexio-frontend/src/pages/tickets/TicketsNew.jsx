import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const CATEGORY_OPTIONS = [
  { value: 'ERROR_SISTEMA',    label: 'Error del sistema' },
  { value: 'CONSULTA_GENERAL', label: 'Consulta general' },
  { value: 'PROBLEMA_MODULO',  label: 'Problema en módulo' },
  { value: 'SUGERENCIA',       label: 'Sugerencia' },
  { value: 'FACTURACION',      label: 'Facturación' },
];

const TicketsNew = () => {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({ title: '', category: 'CONSULTA_GENERAL', priority: 'MEDIA', description: '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleFiles = (e) => {
    const selected = Array.from(e.target.files);
    const valid = selected.filter((f) => f.type.startsWith('image/') && f.size <= 2 * 1024 * 1024);
    const invalid = selected.filter((f) => !f.type.startsWith('image/') || f.size > 2 * 1024 * 1024);
    if (invalid.length > 0) setError('Solo imágenes de hasta 2 MB son permitidas.');
    const combined = [...files, ...valid].slice(0, 3);
    setFiles(combined);
  };

  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const mutation = useMutation({
    mutationFn: (data) => api.post('/tickets', data).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${data.id}`);
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al crear el ticket.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim() || !form.description.trim()) {
      return setError('El título y la descripción son requeridos.');
    }
    const fd = new FormData();
    fd.append('title',       form.title.trim());
    fd.append('category',    form.category);
    fd.append('priority',    form.priority);
    fd.append('description', form.description.trim());
    files.forEach((f) => fd.append('attachments', f));
    mutation.mutate(fd);
  };

  const inputCls = `bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#0F172A]
    placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-colors w-full`;

  return (
    <div className="max-w-lg mx-auto px-6 pt-12 pb-24">
      <div className="mb-8">
        <Link to="/tickets" className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">
          ← Soporte
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mt-4">Nuevo ticket</h1>
        <p className="text-[13px] text-[#94A3B8] mt-1">Describí el problema o consulta.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Título</label>
          <input
            type="text"
            placeholder="Resumen breve del problema"
            value={form.title}
            onChange={set('title')}
            required
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Categoría</label>
            <select value={form.category} onChange={set('category')} className={inputCls}>
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Prioridad</label>
            <select value={form.priority} onChange={set('priority')} className={inputCls}>
              <option value="BAJA">Baja</option>
              <option value="MEDIA">Media</option>
              <option value="ALTA">Alta</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Descripción</label>
          <textarea
            rows={6}
            placeholder="Describí el problema con el mayor detalle posible..."
            value={form.description}
            onChange={set('description')}
            required
            className={`${inputCls} resize-none`}
          />
        </div>

        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">
            Imágenes adjuntas <span className="text-[#CBD5E1] normal-case font-normal">(máx. 3 · hasta 2 MB c/u)</span>
          </label>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
          {files.length < 3 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-[#E2E8F0] rounded-lg px-4 py-3 text-[12px] text-[#94A3B8]
                hover:border-[#3B82F6]/40 hover:text-[#64748B] transition-colors w-full text-left"
            >
              + Agregar imagen
            </button>
          )}
          {files.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
                  <span className="text-[12px] text-[#64748B] truncate">{f.name}</span>
                  <button type="button" onClick={() => removeFile(i)} className="text-[#94A3B8] hover:text-red-400 transition-colors ml-3 text-[11px]">
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="text-[12px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-40 text-white text-[13px] font-medium
              py-2.5 px-6 rounded-lg transition-colors"
          >
            {mutation.isPending ? 'Enviando...' : 'Enviar ticket'}
          </button>
          <Link to="/tickets" className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
};

export default TicketsNew;

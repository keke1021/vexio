import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const FAULT_OPTIONS = [
  { value: 'SCREEN',   label: 'Pantalla' },
  { value: 'BATTERY',  label: 'Batería' },
  { value: 'CHARGING', label: 'Puerto de carga' },
  { value: 'CAMERA',   label: 'Cámara' },
  { value: 'SPEAKER',  label: 'Altavoz / Micrófono' },
  { value: 'BUTTON',   label: 'Botones' },
  { value: 'WATER',    label: 'Daño por agua' },
  { value: 'SOFTWARE', label: 'Software / Reset' },
  { value: 'OTHER',    label: 'Otro' },
];

const Label = ({ children, required }) => (
  <label className="block text-[13px] font-medium text-[#64748B] mb-2">
    {children}{required && <span className="text-[#3B82F6] ml-1">*</span>}
  </label>
);

const Input = ({ className = '', ...props }) => (
  <input
    className={`w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
      placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all ${className}`}
    {...props}
  />
);

const Select = ({ children, ...props }) => (
  <select
    className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#64748B]
      focus:outline-none focus:border-[#3B82F6] transition-all"
    {...props}
  >
    {children}
  </select>
);

const RepairsNew = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    customerName: '', customerPhone: '',
    deviceModel: '', deviceColor: '', deviceImei: '',
    faultType: 'SCREEN', faultDescription: '',
    technicianId: '', budget: '', estimatedDate: '', internalNotes: '',
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const { data: techData } = useQuery({
    queryKey: ['repairs-technicians'],
    queryFn: () => api.get('/repairs/technicians').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (data) => api.post('/repairs', data).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
      queryClient.invalidateQueries({ queryKey: ['repairs-stats'] });
      navigate(`/repairs/${data.id}`);
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al crear la orden.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      ...form,
      budget: form.budget ? parseFloat(form.budget) : undefined,
      estimatedDate: form.estimatedDate || undefined,
      technicianId: form.technicianId || undefined,
    });
  };

  return (
    <div className="px-6 pt-8 pb-16 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link to="/repairs" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Reparaciones</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Nueva orden</span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mb-8">Nueva orden de reparación</h1>

      <form onSubmit={handleSubmit} className="space-y-8">

        <section>
          <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Cliente</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label required>Nombre</Label>
              <Input type="text" placeholder="Juan García" value={form.customerName} onChange={set('customerName')} required />
            </div>
            <div>
              <Label required>Teléfono</Label>
              <Input type="tel" placeholder="11 1234-5678" value={form.customerPhone} onChange={set('customerPhone')} required />
            </div>
          </div>
        </section>

        <section>
          <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Equipo</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Label required>Modelo</Label>
              <Input type="text" placeholder="iPhone 14 Pro" value={form.deviceModel} onChange={set('deviceModel')} required />
            </div>
            <div>
              <Label>Color</Label>
              <Input type="text" placeholder="Space Black" value={form.deviceColor} onChange={set('deviceColor')} />
            </div>
          </div>
          <div className="mt-4">
            <Label>IMEI</Label>
            <Input type="text" placeholder="Opcional" value={form.deviceImei} onChange={set('deviceImei')} className="font-mono" maxLength={15} />
          </div>
        </section>

        <section>
          <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Falla</p>
          <div className="mb-4">
            <Label required>Tipo de falla</Label>
            <Select value={form.faultType} onChange={set('faultType')}>
              {FAULT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </div>
          <div>
            <Label required>Descripción del problema</Label>
            <textarea
              value={form.faultDescription}
              onChange={set('faultDescription')}
              placeholder="Describí en detalle la falla reportada por el cliente..."
              rows={3}
              required
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
                placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all resize-none"
            />
          </div>
        </section>

        <section>
          <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-4">Asignación</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Técnico asignado</Label>
              <Select value={form.technicianId} onChange={set('technicianId')}>
                <option value="">Sin asignar</option>
                {techData?.technicians?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Presupuesto</Label>
              <Input type="number" placeholder="0" value={form.budget} onChange={set('budget')} min="0" step="100" />
            </div>
            <div>
              <Label>Entrega estimada</Label>
              <Input type="date" value={form.estimatedDate} onChange={set('estimatedDate')} />
            </div>
          </div>
        </section>

        <section>
          <Label>Notas internas</Label>
          <textarea
            value={form.internalNotes}
            onChange={set('internalNotes')}
            placeholder="Notas solo visibles para el equipo..."
            rows={2}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all resize-none"
          />
        </section>

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-6 py-2.5
              rounded-lg transition-colors disabled:opacity-40"
          >
            {mutation.isPending ? 'Creando...' : 'Crear orden'}
          </button>
          <Link to="/repairs" className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">Cancelar</Link>
        </div>
      </form>
    </div>
  );
};

export default RepairsNew;

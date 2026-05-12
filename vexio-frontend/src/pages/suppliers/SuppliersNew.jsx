import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

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

const SuppliersNew = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '', city: '', phone: '', email: '', paymentDays: '30', notes: '',
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) => api.post('/suppliers', data).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate(`/suppliers/${data.id}`);
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al crear el proveedor.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      ...form,
      paymentDays: parseInt(form.paymentDays) || 30,
      phone: form.phone || undefined,
      email: form.email || undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="px-6 pt-8 pb-16 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link to="/suppliers" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Proveedores</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Nuevo proveedor</span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mb-8">Nuevo proveedor</h1>

      <form onSubmit={handleSubmit} className="space-y-5">

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label required>Nombre</Label>
            <Input type="text" placeholder="Distribuidora ABC" value={form.name} onChange={set('name')} required />
          </div>
          <div>
            <Label required>Ciudad</Label>
            <Input type="text" placeholder="Buenos Aires" value={form.city} onChange={set('city')} required />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Teléfono</Label>
            <Input type="tel" placeholder="11 4567-8901" value={form.phone} onChange={set('phone')} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" placeholder="contacto@proveedor.com" value={form.email} onChange={set('email')} />
          </div>
        </div>

        <div>
          <Label>Plazo de pago (días)</Label>
          <Input
            type="number"
            placeholder="30"
            value={form.paymentDays}
            onChange={set('paymentDays')}
            min="0"
            max="365"
            className="max-w-[140px]"
          />
        </div>

        <div>
          <Label>Notas</Label>
          <textarea
            value={form.notes}
            onChange={set('notes')}
            placeholder="Condiciones, observaciones..."
            rows={3}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all resize-none"
          />
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-6 py-2.5
              rounded-lg transition-colors disabled:opacity-40"
          >
            {mutation.isPending ? 'Creando...' : 'Crear proveedor'}
          </button>
          <Link to="/suppliers" className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">Cancelar</Link>
        </div>
      </form>
    </div>
  );
};

export default SuppliersNew;

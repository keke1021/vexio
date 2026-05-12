import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const InputField = ({ label, hint, type, placeholder, value, onChange, required, minLength, monospace, small }) => (
  <div>
    <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">
      {label}
    </label>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      required={required}
      minLength={minLength}
      className={`w-full bg-white border border-[#E2E8F0] rounded-lg px-4 text-[#0F172A]
        placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all duration-200
        ${small ? 'py-2 text-[12px]' : 'py-3 text-sm'}
        ${monospace ? 'font-mono' : ''}`}
    />
    {hint && <p className="mt-1.5 text-[11px] text-[#CBD5E1]">{hint}</p>}
  </div>
);

const Register = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    tenantName: '',
    tenantSlug: '',
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleTenantNameChange = (e) => {
    const name = e.target.value;
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-');
    setForm((prev) => ({ ...prev, tenantName: name, tenantSlug: slug }));
  };

  const handleSlugChange = (e) => {
    const slug = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/--+/g, '-');
    setForm((prev) => ({ ...prev, tenantSlug: slug }));
  };

  const mutation = useMutation({
    mutationFn: (data) => api.post('/auth/register', data).then((r) => r.data),
    onSuccess: (data) => {
      login(data);
      navigate('/dashboard');
    },
    onError: (err) => {
      setError(err.response?.data?.message || 'Error al registrar la tienda.');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate(form);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">

        <div className="mb-8 text-center">
          <h1 className="text-[28px] font-bold tracking-tight text-[#0F172A]">Vexio</h1>
          <p className="mt-2 text-[13px] text-[#94A3B8] tracking-wide">Registrá tu tienda</p>
        </div>

        <div className="bg-white rounded-2xl p-8 border border-[#E2E8F0]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <InputField
              label="Nombre de la tienda"
              type="text"
              placeholder="Mi Tienda iPhone"
              value={form.tenantName}
              onChange={handleTenantNameChange}
              required
            />

            {/* Slug — generado automáticamente, editable pero discreto */}
            <div>
              <label className="block text-[10px] font-medium text-[#CBD5E1] mb-1 uppercase tracking-[0.15em]">
                ID de la tienda (generado automáticamente)
              </label>
              <input
                type="text"
                placeholder="mi-tienda-iphone"
                value={form.tenantSlug}
                onChange={handleSlugChange}
                required
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[12px] text-[#94A3B8]
                  font-mono placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
              />
            </div>

            <InputField
              label="Tu nombre"
              type="text"
              placeholder="Nombre Apellido"
              value={form.name}
              onChange={set('name')}
              required
            />
            <InputField
              label="Email"
              type="email"
              placeholder="tu@email.com"
              value={form.email}
              onChange={set('email')}
              required
            />
            <InputField
              label="Contraseña"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={set('password')}
              required
              minLength={8}
            />

            {error && (
              <p className="text-[13px] text-red-500 pt-1">{error}</p>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="w-full bg-[#3B82F6] hover:bg-[#2563EB] text-white text-sm font-medium
                  py-3 rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {mutation.isPending ? 'Creando tienda...' : 'Crear tienda'}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-[13px] text-[#94A3B8]">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="text-[#3B82F6] hover:text-[#2563EB] transition-colors font-medium">
            Iniciá sesión
          </Link>
        </p>

      </div>
    </div>
  );
};

export default Register;

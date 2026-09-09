import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import SyntraFooter from '../components/SyntraFooter';

const InputField = ({ label, type, placeholder, value, onChange, required }) => (
  <div>
    <label className="block text-[13px] font-medium text-[#64748B] mb-2">
      {label}
    </label>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      required={required}
      className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-3 text-sm text-[#0F172A]
        placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all duration-200"
    />
  </div>
);

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) => api.post('/auth/login', data).then((r) => r.data),
    onSuccess: (data) => {
      login(data);
      const role = data.user.role;
      // TECH solo tiene Reparaciones — /dashboard lo rebotaría igual.
      navigate(role === 'SUPERADMIN' ? '/admin' : role === 'TECH' ? '/repairs' : '/dashboard');
    },
    onError: (err) => {
      setError(err.response?.data?.message || 'Error al iniciar sesión.');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate(form);
  };

  return (
    <div className="relative min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">

        <div className="mb-9 flex flex-col items-center text-center">
          <div
            className="w-14 h-14 rounded-2xl bg-[#1E3A5F] flex items-center justify-center"
            style={{ boxShadow: '0 4px 12px rgba(30,58,95,0.25)' }}
          >
            <Smartphone size={26} strokeWidth={2} className="text-white" />
          </div>
          <h1 className="mt-4 text-[28px] font-bold tracking-tight text-[#1E3A5F]">Vexio</h1>
          <p className="mt-1.5 text-[13px] text-[#64748B] tracking-wide">Gestión para tiendas de iPhone</p>
        </div>

        <div
          className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        >
          <div className="h-1 bg-[#1E3A5F]" />
          <div className="p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
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
              />

              {error && (
                <p className="text-[13px] text-red-500 pt-1">{error}</p>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={mutation.isPending}
                  className="w-full bg-[#1E3A5F] hover:bg-[#182f4d] text-white text-sm font-medium
                    py-3 rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {mutation.isPending ? 'Ingresando...' : 'Ingresar'}
                </button>
              </div>
            </form>
          </div>
        </div>

      </div>

      <SyntraFooter variant="fixed" />
    </div>
  );
};

export default Login;

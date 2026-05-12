import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api from '../../api/axios';

const ChangePassword = () => {
  const navigate = useNavigate();
  const [form, setForm]   = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) => api.put('/auth/password', data).then((r) => r.data),
    onSuccess: () => {
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al cambiar la contraseña.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (form.newPassword !== form.confirmPassword) {
      return setError('Las contraseñas nuevas no coinciden.');
    }
    if (form.newPassword.length < 6) {
      return setError('La nueva contraseña debe tener al menos 6 caracteres.');
    }

    mutation.mutate({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
  };

  const inputCls = `bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[13px] text-[#0F172A]
    placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-colors w-full`;

  return (
    <div className="max-w-md mx-auto px-6 pt-12 pb-24">
      <div className="mb-8">
        <Link to="/dashboard" className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">
          ← Volver
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mt-4">Cambiar contraseña</h1>
        <p className="text-[13px] text-[#94A3B8] mt-1">Actualizá tu contraseña de acceso.</p>
      </div>

      {success ? (
        <div className="border border-emerald-200 bg-emerald-50 rounded-xl px-5 py-4">
          <p className="text-[14px] text-emerald-600 font-medium">Contraseña actualizada correctamente.</p>
          <p className="text-[12px] text-[#94A3B8] mt-1">Redirigiendo...</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">
              Contraseña actual
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={form.currentPassword}
              onChange={set('currentPassword')}
              required
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">
              Nueva contraseña
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={form.newPassword}
              onChange={set('newPassword')}
              required
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">
              Confirmar nueva contraseña
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              required
              className={inputCls}
            />
          </div>

          {error && (
            <p className="text-[12px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-40 text-white text-[13px]
              font-medium py-2.5 rounded-lg transition-colors mt-2"
          >
            {mutation.isPending ? 'Guardando...' : 'Actualizar contraseña'}
          </button>
        </form>
      )}
    </div>
  );
};

export default ChangePassword;

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const ROLE_LABELS = { OWNER: 'Owner', ADMIN: 'Admin', SELLER: 'Vendedor', TECH: 'Técnico', SUPERADMIN: 'Superadmin' };

const UsersList = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = user?.role === 'OWNER';

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 60_000,
    enabled: isOwner,
  });

  const users = data?.users ?? [];
  const tiendas = tiendasData?.tiendas ?? [];

  const reassign = useMutation({
    mutationFn: ({ id, tiendaId }) =>
      api.put(`/users/${id}/tienda`, { tiendaId: tiendaId || null }).then((r) => r.data),
    onMutate: () => { setError(''); setNotice(''); },
    onSuccess: ({ user: u }) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setNotice(
        `Sucursal de ${u.name} actualizada a ${u.tienda?.name ?? 'Sin asignar'}. ` +
        'Su sesión activa fue cerrada — deberá volver a iniciar sesión.',
      );
    },
    onError: (err) => setError(err.response?.data?.message || 'No se pudo reasignar la sucursal.'),
  });

  const onBranchChange = (u) => (e) => {
    const tiendaId = e.target.value;
    const currentId = u.tienda?.id ?? '';
    if (tiendaId === currentId) return;
    const label = tiendaId ? (tiendas.find((t) => t.id === tiendaId)?.name ?? 'otra sucursal') : 'Sin asignar';
    const ok = window.confirm(
      `¿Reasignar a ${u.name} a "${label}"?\n\n` +
      'Se cerrará su sesión activa de inmediato y tendrá que volver a iniciar sesión.',
    );
    if (!ok) {
      e.target.value = currentId; // revertir el select
      return;
    }
    reassign.mutate({ id: u.id, tiendaId });
  };

  const th = 'text-left px-4 py-3 text-[11px] font-medium text-[#475569] uppercase tracking-wider';

  return (
    <div className="px-6 pt-8 pb-16 max-w-[1000px] mx-auto">
      <div className="mb-8">
        <Link to="/settings" className="text-[13px] text-[#475569] hover:text-[#64748B] transition-colors">
          ← Configuración
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mt-4">Usuarios</h1>
        <p className="text-[13px] text-[#475569] mt-0.5">
          {isLoading ? '...' : `${users.length} usuario${users.length !== 1 ? 's' : ''}`}
          {' · '}
          El alta y la baja de usuarios se gestionan con soporte.
          {isOwner
            ? ' Podés reasignar la sucursal de un empleado.'
            : ' Sólo el dueño puede reasignar sucursales.'}
        </p>
      </div>

      {notice && (
        <p className="mb-4 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {notice}
        </p>
      )}
      {error && (
        <p className="mb-4 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className={th}>Nombre</th>
              <th className={`${th} hidden sm:table-cell`}>Email</th>
              <th className={th}>Rol</th>
              <th className={th}>Sucursal asignada</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={4} className="text-center py-16 text-[#64748B]">Cargando...</td></tr>
            )}
            {isError && (
              <tr><td colSpan={4} className="text-center py-16 text-red-400">Error al cargar.</td></tr>
            )}
            {!isLoading && !isError && users.length === 0 && (
              <tr><td colSpan={4} className="text-center py-16 text-[#64748B]">Sin usuarios.</td></tr>
            )}
            {users.map((u) => {
              const isSelf = u.id === user?.id;
              const canReassign = isOwner && !isSelf;
              return (
                <tr key={u.id} className="border-b border-[#E2E8F0] last:border-0">
                  <td className="px-4 py-3.5">
                    <p className="text-[#0F172A] font-medium">{u.name}</p>
                    {!u.isActive && <p className="text-[11px] text-red-500">Inactivo</p>}
                  </td>
                  <td className="px-4 py-3.5 text-[#64748B] hidden sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3.5 text-[#475569] text-[12px]">{ROLE_LABELS[u.role] ?? u.role}</td>
                  <td className="px-4 py-3.5">
                    {canReassign ? (
                      <select
                        key={u.tienda?.id ?? 'none'}
                        defaultValue={u.tienda?.id ?? ''}
                        onChange={onBranchChange(u)}
                        disabled={reassign.isPending}
                        className="bg-white border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-[12px] text-[#0F172A]
                          focus:outline-none focus:border-[#3B82F6] transition-colors disabled:opacity-50 max-w-[200px]"
                      >
                        <option value="">Sin asignar</option>
                        {tiendas.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[#475569]">{u.tienda?.name ?? 'Sin asignar'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UsersList;

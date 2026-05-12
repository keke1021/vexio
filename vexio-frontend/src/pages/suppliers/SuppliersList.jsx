import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const SuppliersList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = ['OWNER', 'ADMIN'].includes(user?.role);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then((r) => r.data),
    staleTime: 60_000,
  });

  const suppliers = data?.suppliers ?? [];
  const totalDebt = suppliers.reduce((s, sup) => s + (sup.totalDebt ?? 0), 0);

  return (
    <div className="px-6 pt-8 pb-16 max-w-[1000px] mx-auto">

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Proveedores</h1>
          <p className="text-[13px] text-[#94A3B8] mt-0.5">
            {isLoading ? '...' : `${suppliers.length} proveedor${suppliers.length !== 1 ? 'es' : ''}`}
            {totalDebt > 0 && (
              <span className="ml-2 text-orange-500">· Deuda total: {fmt(totalDebt)}</span>
            )}
          </p>
        </div>
        {canWrite && (
          <Link
            to="/suppliers/new"
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Nuevo proveedor
          </Link>
        )}
      </div>

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Proveedor</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Ciudad</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Plazo</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Contacto</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Deuda</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Items</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-16 text-[#CBD5E1]">Cargando...</td></tr>
            )}
            {isError && (
              <tr><td colSpan={6} className="text-center py-16 text-red-400">Error al cargar.</td></tr>
            )}
            {!isLoading && !isError && suppliers.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-16 text-[#CBD5E1]">
                  Sin proveedores. <Link to="/suppliers/new" className="text-[#3B82F6] hover:underline">Crear uno</Link>
                </td>
              </tr>
            )}
            {suppliers.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/suppliers/${s.id}`)}
                className="border-b border-[#E2E8F0] hover:bg-[#EFF6FF] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3.5">
                  <p className="text-[#0F172A] font-medium">{s.name}</p>
                </td>
                <td className="px-4 py-3.5 text-[#64748B] hidden sm:table-cell">{s.city}</td>
                <td className="px-4 py-3.5 hidden md:table-cell">
                  <span className="text-[#94A3B8] text-[11px]">{s.paymentDays}d</span>
                </td>
                <td className="px-4 py-3.5 hidden lg:table-cell">
                  <p className="text-[#94A3B8] text-[12px]">{s.phone ?? '—'}</p>
                  {s.email && <p className="text-[#CBD5E1] text-[11px]">{s.email}</p>}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {s.totalDebt > 0 ? (
                    <span className="text-orange-500 font-medium tabular-nums">{fmt(s.totalDebt)}</span>
                  ) : (
                    <span className="text-[#CBD5E1]">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 hidden sm:table-cell">
                  <span className="text-[#94A3B8] text-[12px]">{s._count?.items ?? 0}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SuppliersList;

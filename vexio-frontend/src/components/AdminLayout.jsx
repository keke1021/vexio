import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { path: '/admin',          label: 'Tiendas',  exact: true },
  { path: '/admin/stats',    label: 'Métricas', exact: false },
  { path: '/admin/tickets',  label: 'Tickets',  exact: false },
];

const AdminLayout = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (item) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      <header className="bg-white border-b border-violet-200 px-6 h-14 flex items-center justify-between shrink-0"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold tracking-tight text-violet-700 select-none">Vexio</span>
            <span className="text-[9px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded uppercase tracking-widest">
              Admin
            </span>
          </div>
          <span className="text-violet-200">|</span>
          <nav className="flex items-center gap-0.5">
            {NAV.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    active
                      ? 'text-violet-700 bg-violet-100'
                      : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[12px] text-violet-500 hidden sm:block">{user?.name}</span>
          <button
            onClick={handleLogout}
            className="text-[12px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Spinner = () => (
  <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
    <div className="h-6 w-6 rounded-full border-2 border-[#E2E8F0] border-t-violet-500 animate-spin" />
  </div>
);

const AdminRoute = () => {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'SUPERADMIN') return <Navigate to="/dashboard" replace />;

  return <Outlet />;
};

export default AdminRoute;

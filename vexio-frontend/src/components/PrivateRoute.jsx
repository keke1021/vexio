import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Muestra un spinner mientras se verifica el refresh token al cargar la app
const Spinner = () => (
  <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
    <div className="h-6 w-6 rounded-full border-2 border-[#E2E8F0] border-t-[#3B82F6] animate-spin" />
  </div>
);

const PrivateRoute = () => {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;

  return user ? <Outlet /> : <Navigate to="/login" replace />;
};

export default PrivateRoute;

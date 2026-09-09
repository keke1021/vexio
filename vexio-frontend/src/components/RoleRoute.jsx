import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleCanUseModule } from '../config/access';

// Guard de ruta por rol. Va anidado dentro de <PrivateRoute>/<Layout>, así que
// acá `user` siempre existe. Si el rol no puede usar el módulo, redirige a
// /dashboard (Inicio), que es visible para todos los roles.
const RoleRoute = ({ module }) => {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (!roleCanUseModule(user.role, module)) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
};

export default RoleRoute;

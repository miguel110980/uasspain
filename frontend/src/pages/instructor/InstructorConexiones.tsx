import AdminConexionesTiempoReal from '@/pages/admin/AdminConexionesTiempoReal';

/** Usuarios conectados ahora mismo; actualización vía WebSocket /ws/conexiones/. */
export default function InstructorConexiones() {
  return <AdminConexionesTiempoReal readOnly title="Conexiones activas" />;
}

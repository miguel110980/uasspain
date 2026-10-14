import { backupDisplayName } from './infrastructure';

export const backupState = (job) => {
  if (job.status === 'creating' || job.status === 'running') return 'En proceso';
  if (job.status === 'partial') return 'Parcial';
  if (job.status === 'completed' || job.status === 'success') return 'Correcta';
  return 'Error';
};

export const backupDuration = (milliseconds, seconds?) => milliseconds != null
  ? `${(Number(milliseconds) / 1000).toLocaleString('es-ES', { maximumFractionDigits: 3 })} s`
  : Number(seconds) > 0 ? `${seconds} s` : 'Sin medición disponible';

export const backupErrorLabel = (code) => ({
  manifest_missing_or_invalid: 'Manifest ausente o incompatible con los metadatos registrados.',
  checksum_mismatch: 'El checksum del archivo no coincide.',
  size_mismatch: 'El tamaño del archivo no coincide.',
  decryption_failed: 'No se pudo descifrar la copia.',
  incremental_chain_invalid: 'La cadena incremental está incompleta o dañada.',
  historical_destination_configuration_changed: 'Ha cambiado la configuración del destino histórico.',
  artifact_missing_or_destination_unavailable: 'Archivo ausente o destino no disponible.',
  artifact_unavailable_or_invalid: 'La copia no está disponible o es incorrecta.',
  database_archive_invalid: 'El archivo PostgreSQL no es válido.',
  media_archive_invalid: 'El archivo de documentos no es válido.',
})[code] || 'La comprobación no pudo completarse.';

export const backupReplicas = (job) => {
  const replicas = Object.entries(job.destinations || {})
    .filter(([, destination]: [string, any]) => destination.status === 'success')
    .map(([role, destination]: [string, any]) => ({
      id: role === 'local' ? 'local' : destination.server_id || role,
      name: backupDisplayName(destination.server_name, role),
    }));
  if (job.historical_local_available && !replicas.some(replica => replica.id === 'local')) {
    replicas.unshift({ id: 'local', name: 'Almacenamiento histórico local' });
  }
  return replicas;
};

# Backup y recuperación

La implementación activa vive en el backend Rust y se opera desde `/admin/backups` o la API autenticada de administración. Protege PostgreSQL y media, usa AES-256-GCM con nonce aleatorio y una subclave exclusiva del dominio backup, SHA-256, manifiestos versionados, un destino local y hasta dos destinos SFTP independientes.

Los datos persisten en `backups_data`; las identidades SSH y `known_hosts`, en `backup_keys`; la media, en `uasspain_media_data`. Las claves de cifrado llegan mediante Docker secrets y nunca se escriben en el manifiesto: solo se registra un `key_id` derivado y no secreto.

Los artefactos nuevos usan formato v2. La clave AES efectiva se deriva de la
raíz mediante el dominio `uasspain|backup-encryption|v2`, por lo que no se usa
directamente la misma clave efectiva que cifra campos. El lector mantiene un
fallback v1 y acepta la clave maestra anterior para recuperar copias previas
durante una rotación. Separar también la raíz operacional de backup sigue siendo
una mejora pendiente.

## Modelo de recuperación

- Un FULL contiene un `pg_dump` lógico consistente y un ZIP de media.
- Una solicitud INCREMENTAL necesita un FULL válido; si no existe, el backend crea automáticamente ese FULL base.
- Cada punto tiene `parent_backup_id`, `base_full_id`, `chain_index` y un manifiesto JSON con versión, checksums y versiones de aplicación/PostgreSQL/esquema.
- La implementación actual conserva un snapshot lógico completo en cada punto incremental. Esto da una cadena verificable y restaurable, pero no reduce el volumen como un incremental físico PostgreSQL/WAL. No debe declararse el gate `INCREMENTAL_*` de producción hasta desplegar y validar `pg_basebackup --incremental`/WAL o una solución equivalente sobre la infraestructura real.
- Retención y eliminación rechazan cualquier FULL/parent con descendientes, además del último punto bueno.

## Destinos remotos y VPN

En producción `BACKUP_REQUIRE_VPN=true`: `sftp_host` debe coincidir con la IP privada configurada en `vpn_ip`. SFTP exige autenticación por clave, `BatchMode`, `StrictHostKeyChecking` y un archivo `known_hosts` absoluto. Cada artefacto sube con nombre `.partial` y solo aparece con su nombre final después de `rename`.

La topología E2E usa dos peers SFTP aislados en una red Docker y establece explícitamente `BACKUP_REQUIRE_VPN=false`; demuestra el transporte SFTP, no un túnel WireGuard real.

## Antes de restaurar

1. Confirme origen, checksum, antiguedad y ventana de perdida.
2. Verifique que existe una copia independiente utilizable.
3. Preserve un snapshot de seguridad del estado actual.
4. Confirme destino y autorizacion administrativa.

## Verificacion

```powershell
docker compose ps
docker compose logs --tail 200 backend postgres
```

Después del restore valide readiness, login, datos personales, media y registro de auditoría. Los drills externos necesitan destinos SFTP/VPN reales; una prueba local no demuestra disaster recovery externo.

No elimine volumenes para resolver un incidente y nunca use `docker compose down -v` sobre datos reales. Consulte el [runbook de incidentes](../infra/monitoring/INCIDENT-RUNBOOK.md).

## Controles de seguridad

- AES-256-GCM con nonce aleatorio y subclave separada por el dominio `uasspain|backup-encryption|v2`.
- SHA-256 para base, media y manifest; el restore falla cerrado ante cualquier discordancia.
- SFTP por clave, `BatchMode`, validacion estricta de host y publicacion mediante archivo temporal y rename.
- Restore y borrado requieren rol administrador, confirmacion explicita, lock y evento de auditoria.
- La extraccion de media rechaza traversal, symlinks, exceso de entradas y expansiones por encima del limite.

## Estado operativo y limites

La ultima validacion aislada cubrio 79 escenarios funcionales, incluidos full local, dos destinos SFTP independientes, checksums, restore local/remoto, cadena incremental, credenciales invalidas, fallo de conexion y recuperacion. Esta evidencia no sustituye un simulacro de produccion.

Limitaciones conocidas:

- Cada nodo incremental conserva actualmente un `pg_dump` completo; no es un delta fisico ni WAL/PITR.
- Los dos destinos remotos y sus VPN reales deben provisionarse y probarse fuera del laboratorio Docker.
- Falta alerting externo y una comprobacion de capacidad libre en cada peer.
- La subclave de backup esta separada por dominio, pero la raiz operacional debe independizarse y someterse a un drill de rotacion.

`RPO_RTO=NOT_ESTABLISHED`: sin SLA aprobado ni ciclos productivos medidos no se declara un objetivo cumplido. Como punto de partida para aprobacion de negocio puede evaluarse 24 h/4 h en servicio normal y 4 h/2 h en periodos criticos; son propuestas, no resultados.

## Recuperacion ante desastre

1. Nombre un responsable, registre el inicio y bloquee nuevas escrituras sin borrar volumenes ni artefactos.
2. Seleccione el punto mas reciente con manifest `READY` y `verified=true`; valide checksums y, si es incremental, toda la cadena.
3. Levante la version fijada del stack con secretos fuera de Git y espere los healthchecks reales.
4. Ejecute Verify y Restore desde el panel administrativo con confirmacion explicita.
5. Valide HTTPS, login, contenido, media, una escritura controlada y el registro de auditoria.
6. Si falla, mantenga el servicio sin escrituras, preserve evidencia y use el safety snapshot; no reintente a ciegas.
7. Tras un incidente de seguridad, rote credenciales y genere un full nuevo verificado en los tres destinos.

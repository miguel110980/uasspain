# Actualización local y preparación de GitHub

> Continuación autorizada: el titular ha aprobado explícitamente publicar este trabajo pendiente en `codex/auditoria-20261110` del repositorio privado `miguel110980/uasspain`, aunque `RELEASE_GATE=BLOCKED`. La excepción cubre commit/push exclusivamente en esa rama; no modifica `main` ni acredita VALIDATED, PRODUCTION_READY o un release. El informe siguiente conserva el estado observado antes de esa autorización; los SHA y comprobaciones posteriores se registran en las evidencias locales de publicación.

10 de noviembre de 2026. Continuación del estado verificado, sin reconstruir entornos ni cambiar datos reales.

## Resultado observado

- Arranque oficial `powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build`: salida 0. Los cinco servicios superan salud y el verificador de PostgreSQL cifrado. Se reutilizan 45 pasos de caché válidos; Compose conserva los cinco contenedores existentes al no variar las imágenes. No se atribuye una recreación que no ha ocurrido.
- Las cuatro rutas de salud responden 200 mediante TLS con la CA explícita y validación activada.
- Typecheck y lint frontend: salida 0; Vitest: 244/244, 22 ficheros. No se presenta la evidencia Rust anterior como nueva ejecución.
- Sobre el ORIGINAL Docker: certificado local 16/16 y routing/hosts 14/14. La IP retirada continúa rechazada y los tres nombres pendientes devuelven 503.
- Las ocho cuentas protegidas conservan sus hashes normalizados. La clave DPAPI y el certificado CA conservan sus hashes. No se cambian contraseñas, expedientes, volúmenes ni claves.
- Cinco referencias locales de reversión verificadas por hashes, sin exportar imágenes ni copiar el proyecto.
- Gitleaks v8.30.1: salida 0, sin detecciones en el árbol distribuible según `.gitleaks.toml`. No constituye escaneo del historial ni de los directorios privados excluidos.
- Repositorio privado `miguel110980/uasspain`, cuenta con permiso de escritura; fetch realizado. HEAD y origin/main coinciden en `16d1f208acf3dc881cfb272728b57a2ae00d4779`.

## Contenido preparado y límites

Se preparan únicamente código, migraciones, pruebas y documentación de la auditoría. El archivo de respaldo de Nginx queda fuera. `.env` estaba versionado: se retira únicamente del índice para la publicación; el archivo operativo se conserva. Se mantienen los ejemplos de configuración. No se reescribe el historial remoto.

La petición autoriza la subida, pero el plan maestro y el protocolo de reparación condicionan commit/push a superar el gate. F15 (extremos externos) y F16 (mediciones ICE/DTLS/RTP) siguen BLOCKED; además permanecen la compatibilidad estricta de la CA, el indicador Firefox y el E2E integral pendiente. No se ejecuta commit/push mientras rija esa condición. Una eventual publicación de trabajo pendiente requerirá una excepción explícita y no acreditará release ni producción.

Las evidencias detalladas locales están en `.run/github-publication-20261110/`; ese directorio está excluido de Git. Los resultados anteriores se conservan con su fecha y alcance.

## Informe obligatorio

```text
CODE=PREEXISTENTE; sin nuevas modificaciones de aplicación en esta continuación
TESTS=PASS typecheck/lint/244 unitarias; 30 controles HTTP/TLS
DOCKER_BUILD=PASS salida 0, caché válida
DOCKER_DEPLOY=PASS procedimiento oficial, versión vigente
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5
HEALTHZ=200
READYZ=200
API_LIVE=200
API_READY=200
E2E_DOCKER=PASS 30 casos routing/CA; E2E gráfico integral BLOCKED
FUNCTIONAL_TEST=PASS controles HTTP/TLS; media nueva NOT_RUN
SECURITY=PASS integridad y controles locales; FAIL CA estricta anterior; integral BLOCKED
SECRETS_IN_GIT=0 detecciones en alcance escaneado; historial NOT_RUN
COMMIT=NOT_RUN condicionado al gate
PUSH=NOT_RUN condicionado al gate
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779
CRITICAL=No se declara cero global sin auditoría integral
HIGH=F16 BLOCKED
ERRORS=[F15 externos,F16 ICE/DTLS/RTP,CA estricta,Firefox,E2E integral]
CHANGE_STATUS=NOT_COMPLETE validación integral y publicación pendientes
RELEASE_GATE=BLOCKED
SEQUENCE=BLOCKED
CURRENT=GATE_PUBLICACION
NEXT=COMMIT_PUSH_NOT_RUN
REASON=Condición expresa del plan maestro y protocolo de reparación
```

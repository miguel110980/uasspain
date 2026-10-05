# Instrucciones obligatorias de UASSpain

Estas instrucciones se aplican a todas las reparaciones y modificaciones del
repositorio. El procedimiento completo y el formato obligatorio de cierre están
en [docs/REPAIR_WORKFLOW.md](docs/REPAIR_WORKFLOW.md). Léelo antes de realizar cambios.

## Condición de finalización

Un cambio sólo está terminado cuando está aplicado y validado en los contenedores
Docker que ejecutan la aplicación. Código modificado, tests locales, commit o push
por separado no acreditan el despliegue. Si Docker ejecuta una versión anterior,
declara `CHANGE_STATUS=NOT_COMPLETE` y completa la reconstrucción y validación.

La secuencia obligatoria es:

1. Modificar y comprobar el código.
2. Ejecutar los tests afectados y la regresión necesaria.
3. Ejecutar `powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build`.
4. Verificar los cinco servicios permanentes saludables: `nginx`, `frontend`,
   `backend`, `postgres` y `redis` del proyecto `uasspain`.
5. Comprobar HTTP 200 en `https://localhost/healthz`, `/readyz`,
   `/api/health/live/` y `/api/health/ready/`.
6. Ejecutar E2E sobre la versión Docker reconstruida y validar la función real.
7. Revisar seguridad, secretos y `git diff --cached --check`.
8. Crear un commit descriptivo, no vacío, únicamente después de superar los gates.
9. Ejecutar `git fetch origin` y `git push origin main`, sin force push.
10. Comprobar que `HEAD` y `origin/main` coinciden; repetir salud, API ready y
    validación de la función modificada después del push.

## Validación de la versión desplegada

- `docker compose up -d` sin reconstrucción no sustituye al arranque oficial con
  `-Build`. Reconstruir toda la pila está permitido; reutilizar caché sólo cuando
  los inputs de la imagen siguen siendo los mismos.
- Registrar imagen/ID, recreación o reinicio, versión/hash y comportamiento
  desplegado para descartar pruebas contra imágenes antiguas. Un fichero
  modificado en el host no prueba que la nueva configuración esté activa.
- Las pruebas finales comprueban `nginx → frontend/backend → postgres/redis`.
  Un servidor de desarrollo o un build del host no sustituyen esta comprobación.
- El runner `scripts/e2e/run-e2e.ps1` utiliza una pila aislada. Sus resultados
  complementan la validación de la instancia principal; por sí solos no prueban
  que ésta esté actualizada. Identificar siempre origen, versión y alcance.
- Frontend modificado: typecheck, lint, tests, build, rebuild Docker y browser E2E
  de la interfaz servida por el contenedor actualizado.
- Backend Rust modificado: fmt, check, clippy, tests, rebuild y API E2E sobre el
  contenedor actualizado. El target `audit` del Dockerfile reúne los gates Rust.
- Chat, videollamada, presencia, conexiones o WebSocket modificados: comprobar
  WSS, reconexión, autenticación, autorización, aislamiento y entrega real después
  del rebuild. Los unit tests no acreditan estas funciones por sí solos.
- Cambios transversales requieren E2E completo. Los demás requieren los casos
  afectados y su regresión. No presentar pruebas anteriores como una nueva ejecución.
- Si se necesitan migraciones, crear nuevas, probarlas en E2E y aplicarlas por el
  mecanismo del proyecto. Nunca editar migraciones aplicadas ni borrar datos para
  conseguir un PASS.

## Datos y configuración

- La arquitectura permanente tiene exactamente cinco servicios. No añadir otros
  sin autorización expresa.
- No modificar Compose ni Dockerfiles por rutina; hacerlo sólo cuando variables,
  redes, volúmenes, healthchecks, límites, permisos, mounts, dependencias, puertos,
  TLS, runtime o build lo requieran. Aunque Compose no cambie, reconstruir las
  imágenes afectadas.
- Nunca ejecutar `down -v`, `docker volume rm`, `docker volume prune` ni
  `docker system prune --volumes` sobre la pila real.
- Preservar el volumen PostgreSQL cifrado, datos, backups y clave DPAPI. Nunca
  regenerar claves, recrear la base ni usar `-InitializeKey` sobre una base existente.
- No incorporar secretos a imágenes, commits, logs ni informes: `.env` real,
  `.secrets`, DPAPI, claves privadas, contraseñas, tokens y cookies quedan fuera.
- Mantener TLS interno/externo, PostgreSQL cifrado, Redis protegido, redes
  segmentadas, mínimos privilegios, no-new-privileges y read-only donde corresponda.
- Las escrituras y pruebas destructivas usan fixtures aislados. No cambiar
  contraseñas, sesiones ni datos reales para validar una reparación.
- Limpiar sólo contenedores, volúmenes, logs, builds y artefactos temporales propios
  de E2E, verificando su identidad y referencias. No hacer prune global ni tocar
  datos reales o recursos anteriores ajenos a la tarea.

## Fallos y cierre

Si falla build, despliegue, salud, API, E2E o seguridad, detener commit/push,
corregir, reconstruir y repetir las verificaciones necesarias. Comunicar:

```text
SEQUENCE=BLOCKED
CURRENT=<FASE>
NEXT=NOT_RUN
REASON=<CAUSA>
```

Cada reparación debe cerrar con todos los campos del informe de la sección 25
de `docs/REPAIR_WORKFLOW.md`: código, tests, build/despliegue, cinco servicios,
HTTP, E2E Docker, función real, seguridad/secretos, commit/push, ambos SHA,
hallazgos críticos/altos y errores. Informar resultados observados; no completar
un PASS ni un cero con comprobaciones omitidas o pendientes.

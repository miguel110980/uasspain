# UASSPAIN — REGLA OBLIGATORIA DE APLICACIÓN DE CAMBIOS EN DOCKER

## OBJETIVO

A partir de ahora, cualquier reparación, modificación, optimización, corrección de seguridad, cambio de frontend, backend, configuración, WebSocket, base de datos, Nginx, Redis o integración realizada en UASSpain debe quedar aplicada realmente en los contenedores Docker que ejecutan la aplicación.

No se considerará un cambio terminado únicamente porque:

```text
el código haya sido modificado
los tests locales pasen
exista un commit
se haya subido a GitHub
```

La reparación solo se considerará finalizada cuando la versión reconstruida en Docker contenga esos cambios y haya sido validada funcionando.

---

# 1. REGLA PRINCIPAL

Para CUALQUIER cambio:

```text
MODIFICAR CÓDIGO
↓
TESTEAR
↓
RECONSTRUIR DOCKER
↓
LEVANTAR LOS CONTENEDORES ACTUALIZADOS
↓
COMPROBAR 5/5 HEALTHY
↓
EJECUTAR E2E SOBRE LOS CONTENEDORES ACTUALIZADOS
↓
VALIDAR FUNCIONALIDAD REAL
↓
COMMIT
↓
PUSH A GITHUB
```

Si los contenedores todavía ejecutan una versión anterior del código:

```text
CHANGE_STATUS=NOT_COMPLETE
```

---

# 2. PROYECTO

Ruta:

```text
C:\Users\migue\OneDrive\Desktop\UASSpain
```

Arquitectura permanente:

```text
nginx
frontend
backend
postgres
redis
```

No añadir servicios permanentes adicionales salvo autorización expresa.

---

# 3. ARRANQUE Y RECONSTRUCCIÓN OFICIAL

Después de cualquier reparación ejecutar:

```powershell
cd C:\Users\migue\OneDrive\Desktop\UASSpain
.\scripts\start-encrypted-stack.ps1 -Build
```

Este debe ser el procedimiento normal de despliegue local.

No utilizar como sustituto:

```powershell
docker compose up -d
```

cuando se necesite reconstruir la aplicación.

---

# 4. QUÉ DEBE RECONSTRUIRSE

Reconstruir las imágenes afectadas por los cambios.

Ejemplos:

```text
frontend modificado     → reconstruir frontend
backend Rust modificado → reconstruir backend
Nginx modificado        → reconstruir nginx
PostgreSQL image/config → reconstruir postgres
Redis image/config      → reconstruir redis
```

Si el procedimiento actual reconstruye automáticamente toda la pila:

```text
PERMITIDO
```

No optimizar el build de forma que pueda quedar código antiguo dentro de una imagen.

---

# 5. DOCKER-COMPOSE

No modificar:

```text
docker-compose.yml
docker-compose.encrypted.yml
```

por rutina.

Solo modificar Compose cuando el cambio realmente lo requiera:

```text
variables
redes
volúmenes
healthchecks
limits
security options
mounts
dependencies
ports
TLS
```

Pero aunque Compose no cambie:

```text
las imágenes afectadas deben reconstruirse igualmente
```

---

# 6. DOCKERFILES

Modificar Dockerfiles únicamente si es necesario.

Ejemplos:

```text
dependencias del sistema
runtime
build stages
usuarios
permisos
certificados
healthchecks
hardening
```

No realizar cambios innecesarios.

---

# 7. PROTECCIÓN DE POSTGRESQL

PostgreSQL utiliza almacenamiento cifrado.

NO ejecutar:

```powershell
docker compose down -v
docker volume rm
docker volume prune
docker system prune --volumes
```

sobre la pila real.

NO:

```text
borrar el volumen cifrado
regenerar la clave
cambiar la clave DPAPI
recrear la base
usar -InitializeKey sobre una base existente
```

La reconstrucción de contenedores debe preservar los datos.

---

# 8. VALIDACIÓN DE LOS 5 CONTENEDORES

Después de cada build:

```powershell
docker ps --filter "name=uasspain-" --format "table {{.Names}}\t{{.Status}}"
```

Resultado obligatorio:

```text
uasspain-postgres   healthy
uasspain-redis      healthy
uasspain-backend    healthy
uasspain-frontend   healthy
uasspain-nginx      healthy
```

Debe cumplirse:

```text
CONTAINERS_HEALTHY=5/5
```

Si cualquier contenedor está:

```text
unhealthy
restarting
exited
created
```

el proceso queda bloqueado.

---

# 9. VALIDACIÓN HTTP

Después del rebuild ejecutar:

```powershell
curl.exe -k -i https://localhost/healthz
curl.exe -k -i https://localhost/readyz
curl.exe -k -i https://localhost/api/health/live/
curl.exe -k -i https://localhost/api/health/ready/
```

Esperado:

```text
HEALTHZ=200
READYZ=200
API_LIVE=200
API_READY=200
```

No aceptar:

```text
502
503
connection refused
backend unavailable
```

---

# 10. PRUEBAS SOBRE LA VERSIÓN DOCKER

Las pruebas finales deben ejecutarse contra:

```text
la versión recién reconstruida
```

No basta con probar:

```text
código del host
servidor de desarrollo
build local aislado
```

La validación definitiva debe comprobar la aplicación servida por:

```text
nginx → frontend/backend → postgres/redis
```

---

# 11. FRONTEND

Si se modifica frontend:

```text
typecheck
lint
tests
build
Docker rebuild
browser E2E
```

La interfaz probada debe ser la servida por el contenedor actualizado.

---

# 12. BACKEND

Si se modifica backend Rust:

```text
cargo fmt --check
cargo check
cargo clippy
cargo test
Docker rebuild
API E2E
```

Las rutas finales deben responder desde el contenedor actualizado.

---

# 13. WEBSOCKET

Si se modifica:

```text
chat
videollamada
presencia
conexiones
WebSocket
```

validar después del rebuild:

```text
WSS
reconexión
autenticación
autorización
aislamiento de canales
mensajes en tiempo real
```

No declarar PASS basándose solo en unit tests.

---

# 14. MIGRACIONES

Si el cambio necesita migración:

```text
crear migración
probar en entorno E2E
aplicarla mediante el mecanismo del proyecto
validar datos
```

No editar migraciones ya aplicadas.

No borrar datos para hacer pasar la migración.

---

# 15. CONFIGURACIÓN

Si cambia:

```text
.env.example
variables
TLS
CORS
CSP
Nginx
Redis
PostgreSQL
```

comprobar que los contenedores reciben realmente la nueva configuración.

No asumir que un fichero cambiado en el host está activo dentro del contenedor.

---

# 16. VERIFICAR QUE EL CÓDIGO NUEVO ESTÁ DENTRO DEL CONTENEDOR

Cuando sea necesario, comprobar:

```text
imagen reconstruida
container recreated/restarted
timestamp/hash/version coherente
endpoint o comportamiento nuevo activo
```

No aceptar un falso PASS producido por una imagen antigua.

---

# 17. E2E FINAL

Después de reconstruir:

```text
login
panel admin
panel instructor
panel alumno
chat
videollamada
exámenes
material
sesiones
WebSocket
```

Ejecutar los E2E afectados y la regresión necesaria.

Si el cambio es transversal:

```text
E2E completo
```

---

# 18. NO HACER COMMIT ANTES DE VALIDAR DOCKER

El commit final se hará únicamente después de:

```text
CODE=PASS
TESTS=PASS
DOCKER_BUILD=PASS
DOCKER_DEPLOY=PASS
CONTAINERS=5/5_HEALTHY
E2E_DOCKER=PASS
```

---

# 19. COMMIT

Cuando todo esté correcto:

```powershell
git add -A
git diff --cached --check
git commit -m "<mensaje descriptivo>"
```

No crear commit vacío.

---

# 20. PUSH

Después:

```powershell
git fetch origin
git push origin main
```

No usar:

```powershell
git push --force
git push --force-with-lease
```

salvo autorización expresa.

---

# 21. VALIDACIÓN POST-PUSH

Después del push:

```powershell
git rev-parse HEAD
git rev-parse origin/main
```

Deben coincidir.

Volver a verificar:

```text
5/5 healthy
API ready
funcionalidad modificada
```

El push no debe dejar la instancia local rota.

---

# 22. SEGURIDAD

No introducir secretos en imágenes ni repositorio.

No incluir:

```text
.env
.secrets
DPAPI
*.key
*.pem
passwords
tokens
cookies
```

Mantener:

```text
TLS interno
TLS externo
rootless/no-new-privileges cuando corresponda
read-only cuando corresponda
capabilities mínimas
redes segmentadas
PostgreSQL cifrado
Redis protegido
```

---

# 23. LIMPIEZA

Después de pruebas:

eliminar únicamente:

```text
contenedores E2E temporales
volúmenes E2E temporales
logs temporales
builds temporales
artefactos de prueba
```

No tocar datos reales.

---

# 24. CONDICIÓN DE BLOQUEO

Si falla cualquiera:

```text
build
healthcheck
PostgreSQL
Redis
backend
frontend
Nginx
API
E2E
seguridad
```

detener commit/push.

Mostrar:

```text
SEQUENCE=BLOCKED
CURRENT=<FASE>
NEXT=NOT_RUN
REASON=<CAUSA>
```

Corregir.

Reconstruir de nuevo.

Repetir validación.

---

# 25. INFORME FINAL OBLIGATORIO

Cada reparación debe cerrar con:

```text
CODE=
TESTS=
DOCKER_BUILD=
DOCKER_DEPLOY=

POSTGRES=
REDIS=
BACKEND=
FRONTEND=
NGINX=

CONTAINERS_HEALTHY=

HEALTHZ=
READYZ=
API_LIVE=
API_READY=

E2E_DOCKER=
FUNCTIONAL_TEST=

SECURITY=
SECRETS_IN_GIT=

COMMIT=
PUSH=

LOCAL_HEAD=
ORIGIN_MAIN=

CRITICAL=
HIGH=
ERRORS=
```

Resultado esperado:

```text
CODE=PASS
TESTS=PASS
DOCKER_BUILD=PASS
DOCKER_DEPLOY=PASS

POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY

CONTAINERS_HEALTHY=5/5

HEALTHZ=PASS
READYZ=PASS
API_LIVE=PASS
API_READY=PASS

E2E_DOCKER=PASS
FUNCTIONAL_TEST=PASS

SECURITY=PASS
SECRETS_IN_GIT=0

COMMIT=PASS
PUSH=PASS

LOCAL_HEAD=<SHA>
ORIGIN_MAIN=<MISMO_SHA>

CRITICAL=0
HIGH=0
ERRORS=[]
```

---

# 26. REGLA DEFINITIVA

A partir de ahora:

```text
SI EL CAMBIO NO ESTÁ APLICADO EN LOS CONTENEDORES,
EL CAMBIO NO ESTÁ TERMINADO.
```

Por tanto:

```text
REPARAR
→ TESTEAR
→ RECONSTRUIR DOCKER
→ DESPLEGAR
→ 5/5 HEALTHY
→ E2E SOBRE DOCKER
→ VALIDAR FUNCIÓN REAL
→ COMMIT
→ PUSH GITHUB
```

Esta regla se aplicará a todas las reparaciones y modificaciones futuras de UASSpain.

# Infraestructura multiplataforma — ejecución 12–13/10/2026

Estado: `IMPLEMENTED`, `TESTED`, `VALIDATED_LOCAL` y `DEPLOYED_LOCAL`. Preparación independiente terminada y validada en Docker; infraestructura corporativa y plataformas ausentes pendientes. No se declara COMPLETED global ni PRODUCTION_READY. No se ha realizado commit, push, despliegue remoto, instalación de WireGuard ni cambios de firewall/enrutamiento.

Se reutilizan los cinco servicios, secretos de runtime, cifrado PostgreSQL, backups completos/deltas recuperables, inventario y configuración de tres destinos. Los destinos y su activación se guardan en PostgreSQL; SFTP utiliza claves de servicio y known_hosts fuera de las respuestas públicas. Las réplicas se descargan y comprueban mediante checksum antes de acreditar éxito.

La VPN actual consulta `wg show all dump` dentro del contenedor Linux, confunde anfitrión y contenedor y utiliza nombres de interfaz por defecto. Dump incluye material privado que no debe consultarse. El adaptador Windows consulta sólo el primer adaptador y no acredita peers/handshakes. Se sustituirá por instantáneas autenticadas, recientes y de campos públicos, recolectadas externamente con herramientas específicas de Windows/Linux. El backend no adquirirá privilegios ni ejecutará comandos aportados por el navegador.

Los scripts antiguos de WireGuard/firewall asumen roles, direcciones públicas/privadas, wg0, apt/systemd y aplican cambios amplios. No se ejecutarán. Se preparará una vía nueva de comprobación y exportación segura, con parámetros y confirmación técnica para cambios de firewall concretos, sin reiniciar políticas ni instalar software automáticamente.

La auditoría identificó la ausencia de asistente central, estados/evidencias persistentes de preparación, confirmación fiable del anfitrión y mapeo explícito de rutas anfitrión→servicio; esas capacidades se implementan en esta reparación. Una ruta Windows no se utiliza directamente desde un contenedor Linux: el técnico prepara el mount autorizado y se verifica el acceso real. Los destinos existentes no se sustituyen ni duplican.

Antes de aplicar la nueva migración se creó un snapshot cifrado nuevo y se verificó su restauración aislada. La aceptación con escrituras utilizó exclusivamente fixtures aislados; MAIN se comprobó en lectura y con imágenes exactas. Windows Server, servidores Linux físicos/VM y destinos corporativos ausentes se informan como NOT_RUN/BLOCKED, sin prometer compatibilidad probada mediante mocks.

## Implementación

Se añade **Infraestructura → Configuración inicial**, con seis pasos: sistema, servidor/rutas/redes/zona horaria, VPN pública, backups, seguridad y validación. El progreso y la revisión se guardan en PostgreSQL; los escritores obsoletos reciben 409. Exportación pública manual, con auditoría, sin claves ni ejecución automática. La API exige rol administrativo real y mantiene los controles de autenticación/CSRF del proyecto. Los roles alumno/instructor se rechazan con 403, también en peticiones manipuladas.

La capa Rust utiliza adaptadores de rutas Windows/Linux y un contrato común de observaciones autenticadas. Identifica por separado el sistema del servicio Linux, el contenedor y el anfitrión observado. La confirmación técnica manual no acredita un sistema físico. El colector Windows y el Python Linux consultan sólo campos públicos de WireGuard y servicios/interfaces/redes disponibles. No se consulta dump, showconf ni material privado. La ausencia, caducidad o firma inválida deja el servicio BLOCKED; no se utiliza wg0 por defecto ni se inventan peers/handshakes.

El colector escribe atómicamente un JSON firmado con una clave HMAC independiente fuera de Git. El backend lee el directorio montado read-only, sin agente público, sockets administrativos, comandos del navegador ni privilegios nuevos. La fecha se limita a 120 segundos y los handshakes a 180. Identidad, dirección/puerto e IPs permitidas se comprueban antes de acreditar conexión. El colector Linux rechaza ejecución dentro de Docker para no confundir el contenedor con el anfitrión físico.

La migración **0029_infrastructure_preparation.sql** añade exclusivamente `infrastructure_config` e `infrastructure_evidence`. No altera destinos, usuarios, claves, backups ni migraciones anteriores. Las evidencias de preparación y las observaciones de servicio se distinguen mediante alcance/operación; el rol de runtime no puede actualizar ni borrar el historial. Se conservan UTC, actor, revisión e identificador. VERIFIED de preparación no equivale a ACTIVE de VPN ni a disponibilidad de todos los destinos.

El mapeo de almacenamiento exige una raíz autorizada, acceso del servicio y origen coincidente en la observación firmada de los mounts del backend. Guardar un UNC o una ruta de anfitrión no crea el montaje. La comprobación detecta conflictos del rango VPN con redes locales/Docker y reservas corporativas; un inventario incompleto queda NOT_RUN. El nombre/IP del servidor debe resolver y la zona horaria debe ser válida antes de acreditar preparación.

Se reutilizan los tres slots, completos/deltas, manifiestos, programación, cifrado y recuperación existentes. Activación independiente y pruebas de autenticación/escritura/lectura/limpieza/capacidad. Los archivos de prueba se borran sólo después de comprobar su contenido; los SFTP no admiten rutas con glob para evitar borrados por patrón. Las referencias de claves/known_hosts se limitan al almacén autorizado. Los externos de producción requieren peer privado coincidente y observación autenticada con handshake reciente. La excepción sin VPN sólo se usa en E2E con OpenSSH real en red sintética.

Los campos de activación, configuración, última comprobación, error, capacidad y última copia se muestran por separado. Una conexión antigua no acredita disponibilidad actual: el gate usa verificación reciente. La copia local publica sin sobrescribir un archivo existente. FTP sin cifrado, un mount arbitrario y una respuesta ping no son destinos verificados. Todos OFF impide la copia; no se eliminan copias al deshabilitar un destino.

## Herramientas y entrega

`scripts/infrastructure/prepare.ps1` y `.sh` inspeccionan dependencias sin instalar software. La preparación de directorios PowerShell requiere raíz explícita, validación de reparse points y confirmación. Las herramientas de firewall sólo preparan una regla UDP para una IP concreta; aplicar requiere confirmación técnica y no resetea políticas. No se ejecutaron cambios de firewall, rutas, DNS o instalación de WireGuard.

`scripts/start-encrypted-stack.sh` prepara un arranque Linux con claves protegidas y entrega por stdin/tmpfs. El modo ordinario exige un volumen cifrado existente. Una instalación nueva exige dos flags y rechaza cualquier volumen ya existente. `new-linux-storage-key.py` usa creación exclusiva y permisos 0600: no regenera claves. El modo nuevo está preparado, pero no se presenta como una instalación Linux corporativa probada.

`INFRASTRUCTURE_ENABLED=false` permite retirar las nuevas escrituras/UI sin borrar configuración, destinos, evidencias ni esquema. La reversión usa la misma imagen consciente de 0029; no hace downgrade, rollback destructivo ni restaura un backup antiguo. La API de lectura, autenticación y backups conservan su funcionamiento. Se ensaya deshabilitar, denegar operaciones, comprobar conservación exacta y reactivar en la pila aislada. El navegador no puede conmutar esta variable del anfitrión.

La guía de entrega es [infrastructure-operations.md](../infrastructure-operations.md), con requisitos, plataformas, provisión de secretos, WireGuard, firewall, montajes, SFTP, programación, integridad, recuperación, diagnóstico, mantenimiento, rotación y checklist de producción. Se entrega una plantilla pública sin IPs ni credenciales obligatorias. Los scripts antiguos de infraestructura se conservan y se identifican como una vía anterior que requiere revisión independiente; no se ejecutan para esta entrega.

## Backup y conservación

Se conservó el snapshot inicial del 12/10 y se creó otro inmediatamente antes del despliegue del 13/10. Snapshot cifrado nuevo: **60 tablas, 1.236 registros**, checksum, descifrado y restauración en PostgreSQL aislado sin red verificados. El volcado compara cada identificador/huella, no sólo contadores.

```text
BACKUP_CREATED_UTC=2026-10-13T06:10:02.024Z
SNAPSHOT_SHA256=752399696f0e05c0f799f63fb45cde95ef77a231dab4a21665d660fdfac1aca9
BACKUP_RESTORE=PASS
MAIN_INSTANCE_TEST_PROFILES=0
MAIN_DESTRUCTIVE_RESTORES=0
```

La comparación después de desplegar comprobó 1.236 registros anteriores sin cambios/borrados, nueve archivos de backup y diez archivos privados intactos. Volúmenes sin cambios de identidad, incluido `uasspain-rebuild-20261003_postgres_ciphertext`, y claves existentes preservadas. Se creó sólo una clave independiente para observaciones del agente; no se sustituyó una clave de datos/DPAPI/recuperación. Las bajas y el correo ya implementados permanecen; sus pendientes corporativos no se convierten en PASS por esta reparación.

## Pruebas y alcance

Las evidencias privadas se guardan en `.run/infrastructure-20261012/`. La aceptación autenticada utiliza imágenes idénticas a MAIN en HTTPS `https://localhost:8444` con PostgreSQL/Redis/SSH/medios aislados. MAIN sólo se comprueba mediante salud, HTTP/API, WSS público, versión/imagen/binario, denegación anónima y conservación de datos. No se inicia sesión ni se crean fixtures en la base principal.

Gates Rust: fmt/check/clippy y 140 tests. Frontend: typecheck/lint, 71 tests y build. Regresión transversal: 137/137 y bloques adicionales de autenticación, correo, backup, paneles, exámenes, sesiones, chat, vídeo y recuperación de dependencias. Backups: 75 comprobaciones y 184 de inventario/matriz; las ocho combinaciones se verifican con almacenamiento local y SFTP real, checksum, recuperación, fallos y ausencia de réplicas en destinos deshabilitados.

Infraestructura: permisos, manipulación, concurrencia, firmas, caducidad, identidad, handshake antiguo, conflictos, inventario incompleto, montaje no confirmado, capacidad real, persistencia tras reinicio y conservación de configuración/destinos. Los mensajes del agente Windows/Linux de esos contratos son sintéticos y **no acreditan una VPN real ni una plataforma física**. El colector Windows se ejecuta además de verdad en el anfitrión y verifica firma/actualización; informa WireGuard ausente, sin inventar una conexión.

Navegador: seis pasos, persistencia/recarga, validación bloqueada correcta, exportación pública y navegación por teclado. Doce escenarios por paso (320/375/768/1024/1440/1920 px, claro/oscuro), 72 capturas, sin overflow del documento. Las capturas esperan a que terminen las transiciones de color para comprobar legibilidad. La reversión de runtime y su UI se comprueban aparte de las capturas.

Los registros de fixture se identifican por UUID y pertenencia comprobada. Los perfiles, mensajes/archivos propios y configuraciones temporales se limpian/restauran de forma exacta. Se conservan intencionadamente las evidencias protegidas en E2E; no se declara cero de toda evidencia temporal. Se preservan los volúmenes y backups anteriores, sin prune global. No se generaron preguntas mediante IA ni se enviaron mensajes corporativos reales.

Incidencias corregidas: Docker estaba detenido al reanudar; se recuperó sin instalarlo. El Compose E2E no tenía instrucciones build y podía usar una imagen anterior; se construyeron los Dockerfiles directamente y se comprobaron binario/migración. Se corrigió una advertencia clippy del fixture y la sustitución atómica de snapshot en PowerShell. Se normaliza keepalive `off` según el protocolo real de WireGuard. El caché OCI hizo no resoluble un ID local al clonar una imagen; se recuperó la referencia mediante exportación/importación del contenido real, sin tocar contenedores/datos montados ni fingir equivalencia de versiones.

## Plataformas y pendientes

| Capacidad | Alcance real |
|---|---|
| Windows actual + Docker Desktop con contenedores Linux | Preparación/colector/arranque cifrado local probados |
| WireGuard Windows instalado, peers y handshakes reales | NOT_RUN; WireGuard no instalado |
| Runtime Linux de los contenedores | Compilación/API/backup/SFTP/recuperación comprobados |
| Colector/rutas Linux | Implementados; contratos y sintaxis comprobados, anfitrión Linux real NOT_RUN |
| Windows Server | NOT_RUN; no se promete Docker Desktop ni compatibilidad derivada de Windows 11 |
| Ubuntu/Debian/otras distribuciones físicas o VM | NOT_RUN para despliegue corporativo |
| Servidores externos/NAS corporativos | BLOCKED_EXTERNAL; faltan destinos/identidades y pruebas reales |
| VPN corporativa, firewall y rutas | NOT_CONFIGURED/NOT_RUN; no activados |

El técnico debe confirmar motor/FUSE/plataforma, identidades y permisos, provisionar las claves de servicio, preparar mounts, configurar IP/DNS/puertos/peers/redes corporativas, programar el colector, revisar reglas y ejecutar copia/recuperación reales en sus destinos. No se ha modificado DNS de uasspain.com ni activado infraestructura externa inexistente. `PRODUCTION_READY` no se declara. La falta de esos recursos no justifica simular su disponibilidad ni detener la preparación independiente.

## Archivos de esta reparación

- Rust: `src/infrastructure.rs`, `vpn.rs`, integración `lib.rs`, `app.rs`, permisos `db.rs` y protecciones/comprobaciones `backups.rs`.
- Migración nueva: `backend-rust/migrations/0029_infrastructure_preparation.sql`.
- Frontend: `AdminInfrastructure.tsx`, integración `AdminPanel.tsx`, `AdminVpn.tsx` y `BackupDestinationForm.tsx`.
- Runtime: `docker-compose.yml`, `docker-compose.e2e.yml` y `.env.example`; cambios limitados a bindings/variables necesarios, eliminando la IP ficticia por defecto.
- Herramientas: `scripts/infrastructure/host-agent.ps1`, `.py`, `prepare.ps1`, `.sh`, `wireguard-firewall.ps1`, `.sh`, `new-linux-storage-key.py`, plantilla pública y `scripts/start-encrypted-stack.sh`.
- Pruebas: `e2e-infrastructure.mjs`, `e2e-infrastructure-rollback.mjs`, `infrastructure-runtime.ps1`, `frontend/e2e/infrastructure.spec.ts` y actualización del nombre Comprobar conexión en `backups.spec.ts`/`panels.spec.ts`.
- Documentación: este informe y `docs/infrastructure-operations.md`.

Los cambios pendientes anteriores de backups, correo y bajas se conservan. `scripts/start-watch-hidden.vbs` era ajeno a la tarea y no se altera. No se realiza commit, fetch, push ni despliegue remoto sin la autorización específica exigida por esta petición.

## Cierre verificado

Último rebuild oficial completado **13/10/2026, 09:13 de Madrid**. Después se ejecutaron de nuevo reversión, backups, infraestructura, interfaz y regresión posterior a limpieza. Las comprobaciones iniciales no se presentan como una ejecución nueva sobre esas imágenes: la matriz de 184 y el E2E transversal completo corresponden a la ejecución aislada previa; las protecciones de backups no cambiaron después. Sobre las imágenes finales pasan 75 comprobaciones de backups, 50 de infraestructura, 12 de reversión, el navegador y 40 de protección/sesiones/WSS posteriores a limpiar.

```text
BACKEND_IMAGE=sha256:b304fbb3aa1df2af322d3577eb1df66e6011747a3d66b6db3ff4516d96c23377
BACKEND_CONTAINER=e36a32c05f6dbc293e14397ed97c63081c3ff645bb61e5b1d749497a93cfbfd4
BACKEND_STARTED_UTC=2026-10-13T07:13:43.204280832Z
BACKEND_BINARY_SHA256=d3ddccfd422d70323dbcd772f400833e6aa3f5e09bcdfc090701a247953e2638
FRONTEND_IMAGE=sha256:11fe5085c414a7406d9bfebf8b0bfdb7dedc4fc6e6bb055cffb3dd2c8026f4bc
FRONTEND_CONTAINER=713cce0298f4883ef4876371161ab82d5ebfb7549847e4021b2949aaace4ed95
FRONTEND_STARTED_UTC=2026-10-13T07:13:48.888746025Z
FRONTEND_BUILD_ID=2e8f092b-0e0b-4471-81d8-12e0c1b772b1
MIGRATION=29
```

`runtime-proof.json` demuestra equivalencia de imágenes/binario/frontend entre MAIN y E2E. `main-runtime.json` verifica Nginx → frontend/backend → PostgreSQL/Redis, HTTP 200 en los cuatro endpoints obligatorios y WSS público. Las APIs privadas nuevas deniegan acceso anónimo. El usuario del backend puede leer el snapshot/clave del agente mediante mounts read-only; MAIN conserva cero filas de configuración/evidencias de pruebas en las tablas nuevas. No se configura falsamente una VPN en MAIN.

El colector real Windows actualiza y autentica snapshots consecutivos; WireGuard continúa no instalado. La primera instalación Linux y el firewall aplicado no se ejecutaron. Su sintaxis y rechazo de usos no autorizados se distinguen de una prueba real de plataforma. No se atribuyen optimizaciones o mejoras cuantitativas sin comparación medida. Se usan consultas acotadas, singleton versionado, top 20 de evidencias y los índices correspondientes, sin introducir caché de permisos o estados que eluda revocaciones.

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
HEALTHZ=PASS_HTTP_200
READYZ=PASS_HTTP_200
API_LIVE=PASS_HTTP_200
API_READY=PASS_HTTP_200
E2E_DOCKER=PASS_MAIN_IMAGES_ISOLATED_FIXTURES
FUNCTIONAL_TEST=PASS_LOCAL_PREPARATION_WITH_SCOPE_DESCRIBED
SECURITY=PASS
SECRETS_IN_GIT=0
COMMIT=NOT_RUN_BY_EXPLICIT_REQUEST
PUSH=NOT_RUN_BY_EXPLICIT_REQUEST
LOCAL_HEAD=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8
ORIGIN_MAIN=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8
CRITICAL=0
HIGH=0
ERRORS=[]
CHANGE_STATUS=COMPLETE_LOCAL_PREPARATION
GLOBAL_COMPLETED=NOT_DECLARED
PRODUCTION_READY=NOT_DECLARED
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
POST_CLEANUP_REGRESSION=PASS
```

Seguridad: Gitleaks del árbol/historial y Trivy de fuentes/imágenes reales, con secretos y hallazgos HIGH/CRITICAL observados cero. No se transforma ese resultado en una garantía absoluta de ausencia de defectos. `git diff --check` y `git diff --cached --check` pasan; no hay cambios staged. `ORIGIN_MAIN` es la referencia local, sin fetch ni publicación nueva. Los pendientes corporativos de la tabla anterior se mantienen explícitos y no figuran como errores ocultos ni como pruebas PASS.

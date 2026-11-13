# F15: Ubuntu único, configuración y verificación real

12 de noviembre de 2026. ORIGINAL. F15_CONECTIVIDAD=PASS; RELEASE_GATE=BLOCKED_POR_CIERRE_INTEGRAL_PENDIENTE. Este PASS corresponde al único Ubuntu autorizado y a la comprobación integrada real; no acredita la implementación adicional de aplicación de cambios del túnel desde el panel.

## Estado vigente de la continuación

Este apartado sustituye los bloqueos de autorización y elevación de los registros históricos que siguen debajo. Ubuntu es el anfitrión físico, no una máquina virtual. No se ha obtenido shell administrativo mediante la cuenta SFTP restringida.

La tarea `UASSpain-VPN-Host-Observation` ya está instalada y actualiza la observación firmada cada 60 segundos con la sesión Windows autorizada iniciada. Usa ventana oculta, identidad interactiva elevada y archivos protegidos; no almacena contraseña. Lectura actual del registro del colector: inicio `2026-11-12T21:08:54.0420942Z`, fin `2026-11-12T21:08:56.6262725Z`, `TCP22_REACHABLE`, `WRITTEN`, sin errores. Esto acredita conectividad y renovación actuales, no ejecución con Windows sin sesión.

La comprobación integrada real ya pasó: `integrated-success.json`, operación registrada `2026-11-12T19:58:26.31537Z`. Hubo subida, lectura con igualdad de bytes y retirada exclusivamente del nuevo archivo propio `.uasspain-probe-UUID`; se conservó el archivo sintético anterior. No se modificó manualmente el resultado para mostrar éxito.

Tras reiniciar Ubuntu se perdió conectividad. El titular identificó que debía reconectar el Internet proporcionado por el teléfono. Según la comprobación posterior comunicada por el chat coordinador, al hacerlo volvieron el estado Conectado, TCP 22 y SFTP desde el backend con autenticación y huella estrictas (`pwd=/incoming`, salida 0). No se atribuye esa reconexión manual a una reparación remota nuestra ni se ha reescrito WireGuard tras identificar esta dependencia. El registro local actual del colector corrobora TCP accesible. La configuración persistente del peer se había guardado previamente; no está acreditado el arranque completo sin intervención con el enlace del teléfono disponible automáticamente.

| Verificación vigente | Estado | Límite |
|---|---|---|
| Observación periódica firmada | PASS | Sesión Windows autorizada iniciada |
| Comprobación integrada SFTP con ida/vuelta | PASS | Fecha y archivo de evidencia indicados |
| Recuperación después de reconectar Internet del teléfono | PASS | Acción manual del titular; sin nuevo cambio de VPN |
| Arranque completo sin intervención | NOT_RUN | Dependencia del enlace del teléfono; no se usa como nueva avería de VPN ni se exige reiniciar ahora |
| Aplicar desde el panel cambios reales del túnel | NOT_RUN | Implementación adicional iniciada e incompleta, separada de la conectividad ya verificada |

La activación posterior del destino y su inclusión en la programación deben distinguirse de la configuración inicial: la evidencia inicial lo dejó desactivado; no se atribuye su activación posterior a esta operación. F16 permanece fuera de la validación automática por decisión del titular; no se convierte en PASS. La prioridad actual es verificar Google OAuth auténtico, sin reabrir a ciegas la VPN estable.

Actualización de cierre de alcance: el titular confirma que la VPN quedó solucionada y dio por terminada la intervención en Ubuntu. Su apagado posterior es intencionado. Se conservan los PASS funcionales y no se inicia otra comprobación remota por mostrarlo desconectado. OAuth ya se cerró después con proveedor real; véase `2026-11-12-google-oauth-local.md`.

## Alcance vigente

Un único Ubuntu autorizado; no se exige ni se declara un segundo servidor en esta fase. No se acreditan redundancia, ubicación externa independiente, persistencia tras reinicio ni reversión: esos criterios históricos no fueron ejecutados y no se eliminan de la trazabilidad. F16 no se ha modificado.

## Configuración aplicada

Destino external_1, ID e646c2c1-d5c4-40c1-8759-01ea39cc7133, nombre Ubuntu VPN autorizado, IP/peer 10.231.88.2, SFTP 22, usuario uasspainbackup, carpeta /incoming. Credencial existente provisionada exclusivamente en el almacén protegido montado read-only; archivo nuevo con ACL protegida del original, sin publicar valores. known_hosts contiene sólo la clave ED25519 del destino cuya huella se contrastó con la evidencia del Ubuntu. No hay generación de claves ni cambio de credenciales.

Se guardó directamente la configuración autorizada en PostgreSQL mediante transacción con comprobación de ausencia previa, sin suplantar una sesión ni atribuir el cambio a un administrador autenticado: actor NULL y origen explicitado en auditoría. Se conservaron el destino local y las ocho cuentas, con igualdad de huella de identidades, contraseñas/hashes, roles, activación y asignación. No se han activado el destino externo ni copias automáticas.

Datos VPN recuperados del colector existente, ejecutado una vez con elevación expresamente autorizada: UASSpain-Backups, 10.231.88.1/32, UDP 51820, un peer con AllowedIPs 10.231.88.2/32. Claves públicas y endpoint reales guardados; ninguna configuración de túnel, ruta ni firewall se ha cambiado.

## Evidencias actuales

| Caso | Estado | Evidencia |
|---|---|---|
| Windows: ruta al destino por UASSpain-Backups | PASS | Find-NetRoute, origen 10.231.88.1 y ruta 10.231.88.2/32 |
| SFTP Windows: autenticación, cd /incoming, pwd y df | PASS | Huella estricta existente; salida 0, sin escrituras |
| SFTP Docker: autenticación, cd /incoming, pwd y df | PASS | Backend real, clave montada y huella estricta; salida 0 |
| Docker: subida y recuperación sintéticas | PASS | transfer-proof.json; 108 bytes; SHA-256 iguales |
| Prevención de sobrescritura del archivo de ensayo | PASS | SSH_FXF_CREAT combinado con SSH_FXF_EXCL; segundo OPEN rechazado, bytes originales iguales |
| Rechazo de servidor sin huella fijada | PASS | SSH 255 con StrictHostKeyChecking=yes y almacenes vacíos; no se aceptó ninguna clave |
| Observación elevada: firma, contenido y frescura inicial | PASS | 2026-11-12T18:55:32.4585984Z; HMAC válido; bytes idénticos host/backend; edad inicial 15 s |
| WireGuard en esa observación | PASS limitado | Servicio running, un peer, handshake de 65 s, RX/TX positivos; no prueba supervisión continua |
| Campos visibles en Edge administrador | PASS | edge-panel-proof.json; adaptador/IP/puerto/peer y destino guardados |
| Supervisión continua y estado conectado actual del panel | BLOCKED | No existe tarea del colector; observación caduca tras 120 s |
| Comprobación integrada de la aplicación | BLOCKED | Último test 2026-11-12T18:59:20.030942+00:00: error vpn; ver explicación siguiente |
| Regresión del verificador autónomo de escritorio | BLOCKED | ENOENT: falta Configurar-VPN-UASSpain.ps1; no se ha recreado/restaurado fuera del alcance |
| Reinicio, persistencia y reversión reales | NOT_RUN | Excluidos por autorización vigente |

La creación exclusiva sigue el [protocolo SFTP v3, sección 6.3](https://www.ietf.org/archive/id/draft-ietf-secsh-filexfer-02.txt); se usa el SSH del backend, no una conexión alternativa desde Windows. Negociación real y huella figuran en transfer-proof.json.

## Archivo remoto conservado

/incoming/uasspain-f15-fbfbbf89-48bd-4b53-be18-5823afe9d62c.txt

SHA-256 de subida y recuperación: db8ccefa981f74c98e751e4f51dcac0e6c6a7a1bf7dbb9bd5093df404ad068da. Sólo datos sintéticos. No se ha eliminado ni sobrescrito. No se han enviado bases de datos ni datos reales.

## Causa del estado visible

La observación anterior al trabajo era del 13 de octubre, con HMAC válido pero caducada; el panel no podía acreditar estado actual. La ejecución elevada nueva sí observó el túnel y el handshake real. Al no existir refresco periódico, volvió a caducar. El último comprobador integrado falló con código vpn antes del transporte SFTP y guardó status=offline, connection_ok=false. El frontend muestra ese resultado, no el de la prueba independiente Docker. is_active=false no impide test_connection: el endpoint llama probe_destination directamente. No se han manipulado flags ni relajado frescura para mostrar éxito.

El flujo integrado crea un archivo .uasspain-probe-UUID, verifica ida/vuelta y lo elimina después de demostrar sus bytes; por ello no se ha invocado después de caducar la observación ni se ha ejecutado su borrado sin autorización específica. El archivo sintético nuestro anterior permanece intacto.

## Cambio preparado y no aplicado

collector-proposal.json describe una tarea de lectura cada 60 s, límite 45 s, identidad SYSTEM, copia protegida del colector en C:/ProgramData/UASSpain/host-observer/host-agent.ps1 y almacenes existentes. Hash del colector revisado: 13c0420d36319f51231f9132e6b8dc1db5313884497b0a9c25b7ac3149bec73e. No se ha creado tarea/servicio ni persistencia. Pendiente autorización específica. No se ha modificado código funcional: la causa acreditada es ausencia de observación periódica válida.

## Informe de secuencia

CODE=NOT_CHANGED
TESTS=PARTIAL_PASS
DOCKER_BUILD=NOT_RUN_NO_CODE_CHANGE_AND_NO_DEPLOY_AUTHORIZATION
DOCKER_DEPLOY=NOT_RUN
CONTAINERS_HEALTHY=5/5_LAST_OBSERVED_THIS_SESSION
HEALTHZ=PASS_LAST_OBSERVED_THIS_SESSION
READYZ=PASS_LAST_OBSERVED_THIS_SESSION
API_LIVE=PASS_LAST_OBSERVED_THIS_SESSION
API_READY=PASS_LAST_OBSERVED_THIS_SESSION
E2E_DOCKER=PASS_SYNTHETIC_SFTP_ONLY
FUNCTIONAL_TEST=BLOCKED_CONTINUOUS_MONITORING_AND_INTEGRATED_CHECK
SECURITY=PARTIAL_PASS_HOST_PIN_AND_CREDENTIAL_ACL
SECRETS_IN_GIT=NOT_AUDITED_GLOBALLY_NEW_CREDENTIAL_PATHS_IGNORED
COMMIT=NOT_RUN_NOT_AUTHORIZED
PUSH=NOT_RUN_NOT_AUTHORIZED
LOCAL_HEAD=3db68f34e62f382ee60a21ec4e2d035957c70282_LAST_OBSERVED_THIS_SESSION
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779_LAST_OBSERVED_THIS_SESSION
CRITICAL=NOT_REASSESSED
HIGH=NOT_REASSESSED
ERRORS=STALE_AGENT; VPN_CHECK_REJECTED; STANDALONE_SCRIPT_MISSING
SEQUENCE=BLOCKED
CURRENT=CONTINUOUS_OBSERVATION_AND_INTEGRATED_CHECK
NEXT=NOT_RUN
REASON=SPECIFIC_AUTHORIZATIONS_PENDING

Evidencia local: C:/Users/migue/OneDrive/Desktop/UASSpain/.run/f15-live-20261112-fdf84891. Los PASS se limitan a su fecha, versión y ámbito. No es cierre de la auditoría integral.

## Continuación: limpieza integrada autorizada y elevación cancelada

2026-11-12T19:16:58.951Z. El titular autoriza ahora borrar sólo el nuevo archivo .uasspain-probe-UUID que genere la comprobación integrada después de verificar sus bytes. No se elimina el sintético previo ni ningún backup. La sesión administradora de Edge se ha inspeccionado de nuevo; se abrió la página de Copias de seguridad y se identificó su botón de verificación del único Ubuntu. La prelectura SFTP desde Docker pasó; no había nombres coincidentes con /incoming/.uasspain-probe-*.

La invocación puntual autorizada del colector mediante Start-Process -Verb RunAs terminó con error de Windows: «El usuario ha cancelado la operación». No se ejecutó el colector ni se actualizó la observación. No se intentó el comprobador integrado después: su prerrequisito de observación actual seguía fallido. No hubo nuevas escrituras ni borrados remotos en este intento. No se ha manipulado connection_ok ni el estado de VPN.

Se dejó abierto y se observó directamente en Edge https://localhost/admin?section=vpn: Estado desconocido y Ubuntu VPN autorizado / Conexión no disponible; los campos UASSpain-Backups y 10.231.88.1/32 siguen guardados. La autorización de limpieza ya no es bloqueo; los bloqueos actuales son elevación no completada y falta de autorización para supervisión persistente. La propuesta concreta está en collector-proposal.json y no se ha instalado. CHANGE_STATUS=NOT_COMPLETE; F15=BLOCKED; RELEASE_GATE=BLOCKED. Evidencia: C:/Users/migue/OneDrive/Desktop/UASSpain/.run/f15-live-20261112-fdf84891/integrated-attempt-a65a5efd-8770-4bae-9fdb-ed8bed4f767f.json.

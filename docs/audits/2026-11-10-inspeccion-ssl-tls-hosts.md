# UAS Spain ORIGINAL — inspección SSL/TLS y retirada de host

10 de noviembre de 2026. Continuación del estado verificado. Evidencias UTC en `.run/tls-inspection-20261110/`. **RELEASE_GATE=BLOCKED.** No se declara VALIDATED ni PRODUCTION_READY.

## Resultado observado

TLS está configurado y se ha negociado realmente en los cinco servicios. No se ha habilitado SSL obsoleto para solucionar un aviso del navegador.

| Tramo | Evidencia real | Estado |
|---|---|---|
| Navegador/cliente → Nginx | TLS1.2 y TLS1.3, CA y nombre localhost verificados; repetido tras actualizar | PASS |
| Nginx → frontend | TLS1.2 y TLS1.3, certificado verificado y HTTP200; repetido tras actualizar | PASS |
| Nginx → backend | TLS1.2 y TLS1.3, certificado verificado y HTTP200; repetido tras actualizar | PASS |
| Backend/red de datos → PostgreSQL | TLS1.2 y TLS1.3, CA y nombre postgres verificados | PASS |
| Backend/red de datos → Redis | TLS1.2 y TLS1.3, CA y nombre redis verificados | PASS |
| PostgreSQL de aplicación | ssl=on, mínimoTLS1.2, DB_SSLMODE=verify-full; conexiones de pool observadas TLS1.3/AES256GCM | PASS |
| Redis | PONG autenticado sobre TLS; PING sin cifrado rechazado con reset | PASS |
| TLS1.0/TLS1.1 en el edge | Respuesta fatal protocol_version70 a ClientHello real | PASS, rechazados |
| SSLv2/SSLv3 | Configuración Nginx activa sólo permite TLS1.2/TLS1.3. SSLv3 ClientHello recibe fatal40; no se atribuye causa de versión a ese40. SSLv2 no sondeado | Configuración PASS; prueba específica limitada |

Los clientes OpenSSL instalados inicialmente no podían emitir TLS1.0/1.1: se registró BLOCKED de cliente, sin adjudicar al servidor ese fallo. Después se enviaron únicamente mensajes ClientHello al loopback para obtener las respuestas reales, sin establecer una sesión ni transmitir credenciales ni rebajar configuraciones. La interpretación de protocol_version70 y el formato del mensaje se apoyan en [RFC5246](https://www.rfc-editor.org/rfc/rfc5246.html). El control TLS1.2 con las mismas suites antiguas devuelve handshake_failure40, distinto del rechazo70.

En la primera prueba interna, Host backend recibió400 después de negociar TLS correctamente. Se conserva esa evidencia como rechazo del host, no como fallo del cifrado. La repetición con Host localhost, como el proxy real, devuelve200.

## Hosts y causa del indicador «Ninguno»

El backend lee tls_pending_hosts de una lista de bloqueos mantenida por el operador; no comprueba automáticamente certificados. Estaba vacía, y dos pantallas convertían ese vacío en «Ninguno», sin aclarar el alcance.

Se contrastaron los nueve hosts inicialmente permitidos mediante SNI contra Nginx local, con validación de cadena y nombre. Cinco coinciden con su certificado; cuatro no. Esto comprueba el servidor local y sus certificados, no la accesibilidad desde Internet.

- localhost,127.0.0.1 y192.168.1.38: certificado de CA local, SAN correcto, sujeto edge. La confianza de cliente depende de importar esa CA.
- uasspain-prueba.duckdns.org ywww.uasspain-prueba.duckdns.org: cadena pública de Let's Encrypt aceptada sin CA privada, HTTP200. Caducidad21 de enero de2027. Prueba por SNI local; no se afirma alcance WAN/DNS externo.
- uasspain.com,www.uasspain.com ymiguel.taile0e59c.ts.net: certificado sin SAN compatible. Se mantienen como pendientes en tls_pending_hosts.conf y Nginx devuelve503 antes del proxy. Resolver sus certificados requiere provisión/validación posterior; no se emitieron certificados ni se cambió DNS.
- **81.38.148.209: retirada de allowed_hosts.conf por orden expresa.** Ya no es un host admitido. Edge cierra la solicitud y el backend devuelve400; antes del reinicio devolvía200. No se borraron historiales ni se alteraron datos de usuarios.

No había referencias de esta IP en valores de configuración operativa .env/Compose ni en el entorno del backend. No se modificaron archivos de secretos. Se conservaron los demás hosts y orígenes.

## Reparación aplicada

- nginx/allowed_hosts.conf: retirada exacta de la IP autorizada.
- nginx/tls_pending_hosts.conf: tres alias sin certificado coincidente señalados como pendientes.
- frontend/src/lib/systemStatus.ts: presentación compartida «Bloqueos TLS configurados». Una lista vacía ahora indica que no hay bloqueos configurados y que el indicador no ha comprobado certificados. Datos ausentes/malformados permanecen no disponibles; no se presentan como validación correcta.
- AdminConfiguracion.tsx yAdminSeguridad.tsx: consumen el mismo criterio. También se retira la afirmación global «El sistema está seguro» derivada únicamente de ausencia de alertas de acceso.
- systemStatus.test.ts: diez casos de lista vacía, poblada y datos desconocidos/incorrectos.

No hay cambios de diseño, CSS, componentes, menús, rutas ni contratos API. La actualización de copia/estado no sustituye la provisión de certificados pendientes.

## Pruebas y aplicación en Docker

Typecheck PASS; lint PASS; **244/244 pruebas frontend PASS**; build/prerender de diez páginas y verificación de155 entradas PASS.

Preflight Nginx sin puertos públicos y con mounts de sólo lectura: nginx-t y14 casos PASS. Fixture propio identificado y retirado, sin borrar volúmenes. Las primeras adaptaciones de la prueba distinguieron correctamente dos comportamientos del cliente: Nginx444 se representa como cierre/reset52/56 o streamHTTP2/92, y variar Host en Node puede variar su SNI implícito. La prueba final verifica siempre TLS contra localhost y varía sólo HTTP Host para comprobar el enrutamiento. Las pruebas SNI por nombre son independientes y no se omitió la validación del certificado.

Vía de reversión: referencias locales a imágenes existentes de Nginx, frontend y backend, verificadas contra binarios/configuración/paquetes/versiones reales; copias limitadas de las dos listas en before-host-fix.json. No se creó una copia del proyecto, snapshot de contenedor, entorno de datos ni clave nueva.

Se ejecutó el procedimiento oficial con -Build y Services nginx,frontend,backend. Nginx y frontend se recrearon. El backend reutilizó exactamente su binario e imagen de ejecución; Compose lo mantuvo en marcha al no cambiar sus inputs. Se reinició de forma explícita para volver a cargar AppState y la allowlist: la IP retirada pasó de200 a400. Después se repitió el arranque oficial parcial para esperar salud y validar el almacenamiento cifrado.

Versión frontend servida: **37a0c9c1-01af-46ce-9c7c-5316da8600ed**. El asset AdminPanel-BrAiyY9B.js del contenedor incorpora el nuevo texto. Las94 entradas fuente backend y su binario siguen iguales a la revisión anterior: no se presenta una nueva compilación/prueba Rust de código modificado.

Estado tras aplicar: cinco servicios healthy, cuatro endpoints200 con TLS validado,14 casos de enrutamiento PASS,16 casos de oferta CA PASS, endpoint admin sin autenticación401 y WSS sin autenticación401 sin upgrade. PostgreSQL y Redis conservan ID/imagen/arranque. Las ocho huellas de perfil/credenciales son idénticas. Migraciones: versión máxima34, todas correctas, última instalación9 de noviembre; ninguna migración nueva aplicada en esta intervención.

**E2E gráfico administrativo: BLOCKED.** La herramienta no admite el control de Firefox Windows; no se extrajeron cookies ni se sustituyó su sesión para sortear ese límite. Código, asset y contrato de routing están comprobados; no se atribuye una observación gráfica de los paneles ni una llamada multimedia nueva a esta continuación.

## Firefox, CA y aviso «No seguro»

Firefox sólo descargó el certificado desde la ruta preparada: la oferta automática de importación no superó la prueba real. La importación manual del usuario sí ha quedado registrada posteriormente en el perfil predeterminado de la instalación: CA exacta y atributo estándar PKCS11 serverAuth=2, trust anchor, vinculado a suSHA256. La inspección de cert9.db fue inmutable y sólo leyó certificados públicos/confianza; no se accedió a claves privadas, cookies, navegación ni ajustes de proxy.

En Windows la CA aparece en Intermedias, no en Raíces de confianza. El agente no ha importado certificados en esos almacenes. Eso explica que su instalación de Windows no constituya confianza raíz; no se traslada a Firefox, que ya tiene su propio anclaje confirmado. Referencias técnicas: [tipos PKCS11 de NSS](https://raw.githubusercontent.com/nss-dev/nss/master/lib/util/pkcs11t.h), [importación de autoridades en Mozilla](https://wiki.mozilla.org/CA/Changing_Trust_Settings).

El usuario sigue observando «No seguro» después de cerrar/reabrir Firefox. **La causa concreta del indicador no está verificada**: sólo se dispone del texto genérico, sin código detallado ni certificado observado en esa conexión. No se afirma que el dominio o la falta de TLS sean la causa. En el servidor, localhost está cubierto por SAN y negocia TLS correctamente. IPv4 loopback sirve el certificado esperado; IPv6 loopback443 devuelve ECONNREFUSED, sin otro certificado observado.

Además, la CA antigua carece de keyUsage. La comprobación estricta OpenSSL falla con error92. **FAIL confirmado de compatibilidad estricta**, distinto de atribuirle el aviso Firefox. No se regeneró ni sustituyó CA, certificados o claves; esa operación criptográfica requerirá un alcance y reversión específicos.

## Rendimiento medido, sin afirmar mejora no medida

Se desbloqueó una línea base usando el nombre público ya configurado y su cadena pública válida. Lighthouse13.5.0, tres navegaciones móviles estándar sobre el ORIGINAL Docker, con resolución de ese nombre al loopback únicamente dentro del proceso Chromium de prueba. No se cambió DNS del sistema ni se usaron excepciones/flags de bypass de certificados.

Resultados:99,100,100. Medianas: LCP1651,9236ms; TBT0ms; CLS0,000937456. No son una comparación antes/después de la reparación ni una medición de Firefox/WAN. INP yReactProfiler NOT_RUN; TBT no se presenta como INP. No se introducen optimizaciones adicionales sin un problema medido.

## Continuidad y cierre obligatorio

Se conserva la matriz de17 hallazgos anteriores:15PASS y2BLOCKED(F15/F16); F17 continúaPASS. La matriz específica de esta continuación es2026-11-10-ssl-tls-verificacion.csv. No se ocultan los alias pendientes, la validación estricta fallida, el aviso Firefox ni los E2E maestros pendientes detrás del total histórico.

```text
SEQUENCE=BLOCKED
CURRENT=AVISO_FIREFOX_CA_ESTRICTA_E2E_Y_AUDITORIA_MAESTRA
NEXT=NOT_RUN
REASON=TLS activo y retirada de IP comprobados; aceptacion integral pendiente
CHANGE_STATUS=NOT_COMPLETE
TLS_HOST_FIX_STATUS=APPLIED_TESTED_DOCKER
RELEASE_GATE=BLOCKED
CODE=PASS correccion de indicador/listas; sin cambios Rust
TESTS=PASS typecheck,lint,244frontend,build,14preflight,14ORIGINAL,16CA,TLS y permisos acotados
DOCKER_BUILD=PASS nginx/frontend/backend oficial; cache valida en backend inalterado
DOCKER_DEPLOY=PASS nginx/frontend recreados; backend reiniciado para configuracion
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5 ORIGINAL
HEALTHZ=PASS HTTP200 CA validada
READYZ=PASS HTTP200 CA validada
API_LIVE=PASS HTTP200 CA validada
API_READY=PASS HTTP200 CA validada
E2E_DOCKER=PASS routing/TLS/API/WSS negativo; GUI administrativa y media real nueva BLOCKED/NOT_RUN
FUNCTIONAL_TEST=PASS IP retirada,3alias503,TLS1.2/1.3; Firefox No seguro sin resolver
SECURITY=PASS controles de cambios; FAIL compatibilidad CA estricta; BLOCKED integral
SECRETS_IN_GIT=0 coincidencias Gitleaks del arbol distribuible con exclusiones existentes; final-checks.json; sin afirmar todo el historial
COMMIT=NOT_RUN prohibido por usuario
PUSH=NOT_RUN prohibido por usuario
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779 referencia local sin fetch
CRITICAL=No se declara cero global
HIGH=F16 BLOCKED; no se declara cero global
ERRORS=[Firefox sin causa detallada,CA antigua error92,3certificados pendientes,E2E completo,F15 externos,F16 ICE-DTLS,verificaciones maestras]
```

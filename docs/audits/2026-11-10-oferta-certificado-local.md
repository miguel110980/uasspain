# UAS Spain ORIGINAL — oferta de instalación de la CA local

> **Actualización posterior verificada:** Firefox sólo descargó el archivo; la importación manual del usuario ya figura como raíz de confianza en su perfil predeterminado. El aviso «No seguro» sigue pendiente. La IP solicitada se retiró y se verificó TLS real en cinco servicios. El cierre inicial siguiente es histórico; véase [el informe vigente](2026-11-10-inspeccion-ssl-tls-hosts.md).

10 de noviembre de 2026. Continuación de la auditoría. El usuario ha concretado la petición: que el navegador ofrezca instalar el certificado. **No se ha importado automáticamente confianza en Windows ni en Firefox.**

## Identidad y alcance

CA pública existente: UASSpain Internal CA. Huella SHA256 DER: CA:18:A4:38:D9:7D:97:DC:2F:FD:3D:B4:67:20:E8:1D:CD:BD:3D:D9:8B:5F:BB:70:A3:8F:45:E2:33:54:3A:A3. Se verificaron autofirma, CA=true, vigencia, firma de edge y SAN localhost. La hoja servida en HTTPS coincide con edge.crt. No se leyeron ni publicaron claves privadas, ni se regeneraron certificados.

El almacén de Windows no contenía esta raíz al inspeccionarlo. La CA no tiene extensión keyUsage: se conserva el bloqueo histórico de validación estricta Python; ofrecer o importar confianza no cambia sus extensiones.

## Reparación mínima

Se añade sólo la ruta exacta https://localhost/instalar-certificado.crt en nginx/nginx.conf. Lee el certificado público ya montado, con application/x-x509-ca-cert, disposición inline y nombre UASSpain-Local-CA.crt. Sólo GET/HEAD; otros métodos denegados; otros hosts permitidos reciben404; caché no-store y cabeceras de protección conservadas. No se permite listar directorios ni descargar claves.

No se cambia frontend, diseño, rutas de aplicación, Compose, puertos, secretos, cuentas ni expedientes. HTTP conserva su redirección a HTTPS. El aviso TLS inicial del navegador ocurre antes de que pueda ejecutarse una página: esta oferta no lo sustituye ni lo acepta por el usuario.

La [especificación NSS de Mozilla](https://raw.githubusercontent.com/nss-dev/nss/master/doc/src/legacy/certificate_download_specification/index.md) describe este MIME para presentar diálogos de aceptación de CA, pero es documentación heredada. El comportamiento de la versión concreta de Firefox exige observación real: no se convierte la respuesta HTTP en un PASS de importación. Si Firefox sólo descarga el archivo, la importación manual seguirá siendo necesaria.

## Pruebas y reversión

- Configuración Nginx comprobada antes de actualizar: PASS.
- Preflight temporal sin puertos públicos y con mounts de sólo lectura: 16/16 PASS; contenedor propio identificado y retirado sin borrar volúmenes.
- Runtime anterior resoluble por su etiqueta, aunque su antiguo ID no era consultable: seis huellas de binario, configuración, proxy, OpenSSL y paquetes coinciden con el contenedor real. Referencia local conservada: codex-uasspain-certificate-rollback:20261110. No se creó snapshot ni copia del proyecto. Restauración NOT_RUN.
- Procedimiento oficial: powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build -Services nginx. Exit0; sólo Nginx recreado. Otros cuatro contenedores con ID, imagen y arranque intactos.
- Prueba repetida sobre el ORIGINAL reconstruido: 16/16 PASS. Cuerpo idéntico al certificado público, una única CA, ningún bloque PRIVATE KEY; MIME, inline, no-store y cabeceras; HEAD, POST denegado, host alternativo denegado, rutas sensibles404 y readyz200.
- Cinco servicios healthy; cuatro endpoints200 con validación TLS explícita. Ocho huellas de perfil/credenciales iguales. Verificación de volumen cifrado del arranque oficial PASS.
- git diff --check y cached --check PASS. Gitleaks exit0, cero coincidencias con exclusiones existentes; no afirmación sobre todo el historial.

Script reproducible de sólo lectura: scripts/security/test-local-ca-offer.mjs. Evidencias: .run/certificate-trust-20261110/{certificate-review.json,rollback-proof.json,preflight-tests.json,preflight-cleanup.json,deployed-tests.json,after-deployment.json,gitleaks.json}. La matriz específica distingue respuesta servida de instalación confirmada.

## Estado del navegador y continuidad

CERT-BROWSER-OFFER=BLOCKED, pendiente de respuesta del usuario sobre el diálogo de Firefox. CERT-WINDOWS-TRUST=NOT_RUN. La confirmación final de confianza corresponde al usuario. No se afirma que instalar en Firefox habilite la confianza de Chromium o de Python.

Se conservan los 17 hallazgos: 15 PASS y F15/F16 BLOCKED. F17 sigue PASS. La auditoría integral y las mediciones de frontend continúan pendientes según su informe anterior; no se reconstruye frontend por esta ruta adicional ni se atribuye una llamada multimedia nueva a esta intervención.

## Cierre obligatorio, sección25

```text
SEQUENCE=BLOCKED
CURRENT=OBSERVACION_OFERTA_FIREFOX_Y_AUDITORIA_INTEGRAL
NEXT=NOT_RUN
REASON=Ruta de oferta comprobada; importacion/confianza real pendiente
CHANGE_STATUS=NOT_COMPLETE
CA_ENDPOINT_STATUS=APPLIED_TESTED_DOCKER
RELEASE_GATE=BLOCKED
CODE=PASS ruta Nginx y prueba de integracion
TESTS=PASS nginx-t,16preflight,16ORIGINAL
DOCKER_BUILD=PASS nginx solamente
DOCKER_DEPLOY=PASS nginx local mediante procedimiento oficial
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5 ORIGINAL
HEALTHZ=PASS HTTP200 TLS validado
READYZ=PASS HTTP200 TLS validado
API_LIVE=PASS HTTP200 TLS validado
API_READY=PASS HTTP200 TLS validado
E2E_DOCKER=PASS contrato HTTPS del certificado y regresion acotada; dialogo Firefox BLOCKED
FUNCTIONAL_TEST=PASS descarga CA exacta; oferta/importacion de navegador pendiente
SECURITY=PASS controles de esta ruta; BLOCKED integral
SECRETS_IN_GIT=0 coincidencias de arbol distribuible con exclusiones existentes
COMMIT=NOT_RUN prohibido por usuario
PUSH=NOT_RUN prohibido por usuario
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779 referencia local sin fetch
CRITICAL=No se afirma cero global
HIGH=F16 BLOCKED; no se afirma cero global
ERRORS=[Observacion Firefox pendiente, CA estricta Python, metricas/E2E integral, F15 externos, F16 ICE-DTLS]
```

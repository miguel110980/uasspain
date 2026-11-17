# UAS Spain ORIGINAL — continuación de seguridad y paneles

10 de noviembre de 2026, Europe/Madrid. Continuación del
[informe de limpieza y E2E local](2026-11-10-limpieza-e2e-local.md).
No se reiniciaron la auditoría, los servicios ni los entornos.

**CHANGE_STATUS=NOT_COMPLETE · RELEASE_GATE=BLOCKED.**
La [matriz de esta continuación](2026-11-10-continuacion-seguridad.csv) contiene
19 controles agrupados PASS y uno BLOCKED, tras el cierre gráfico de F17.
Los 17 hallazgos históricos quedan en 15 PASS y dos BLOCKED según la
[actualización F17](2026-11-10-f17-grafico.md). Estas matrices no sustituyen los 81 casos ni los
441 controles maestros pendientes de cobertura completa.

Evidencias nuevas: `.run/continuation-20261110/`. Sus fechas se expresan en UTC.

## SMTP real: transporte TLS PASS, entrega pendiente

Se contrastó la configuración SMTP actual de la base original con el destino
ensayado. Se ejecutó exclusivamente EHLO → STARTTLS → EHLO → QUIT, con validación
de certificado por las CA del sistema y verificación del nombre del servidor.

- EHLO inicial: 250; STARTTLS anunciado; respuesta al cambio TLS: 220.
- EHLO después del cifrado: 250.
- Versión negociada: TLS 1.2.
- Cifrado: ECDHE-RSA-AES256-GCM-SHA384.
- Certificado válido en la comprobación, con caducidad declarada el 17/04/2027.
- Sin AUTH, MAIL FROM, destinatario ni envío de mensajes.

Resultado: **PASS del transporte**. No se convierte la entrega externa, la
autenticación SMTP ni la aceptación de remitentes en PASS con esta comprobación.
El último test de envío operativo registrado sigue siendo el anterior; no se
cambió configuración ni evidencia de aceptación en la aplicación.

Evidencia: `smtp-provider-tls-transport.json`.

## Seguridad HTTP del ORIGINAL: ocho comprobaciones PASS

Se realizaron cinco peticiones HTTPS, sin iniciar sesión con cuentas reales ni
guardar el valor de ninguna cookie:

1. HTML con HSTS, nosniff, X-Frame-Options DENY y Referrer-Policy.
2. Acceso anónimo a `/api/auth/me/` rechazado con 401.
3. Cookie de contexto `__Host-uasspain_context`: Secure, HttpOnly, SameSite=Strict,
   Path=/ y sin atributo Domain.
4. Preflight del origen autorizado localhost con el origen y las credenciales
   explícitamente permitidos.
5. Preflight de un origen ajeno sin Access-Control-Allow-Origin que lo autorice.
6. CSP con restricciones `object-src 'none'` y `frame-ancestors 'none'`.
7. Cámara y micrófono restringidos a self; geolocalización deshabilitada.
8. Respuesta de contexto con Cache-Control: no-store.

La creación de un contexto anónimo no otorga una identidad ni modifica perfiles
o expedientes. Estos resultados verifican las condiciones enumeradas, no una
ausencia universal de XSS, CSRF o fallos de autenticación.

Evidencia: `http-security-probes.json`.

## Scripts de WireGuard: validadores PASS, despliegue BLOCKED

Se evaluó sólo la función pura de validación de IP de cada script existente del
Escritorio, tras inspeccionarla y comprobar la huella de sus bytes:

- PowerShell: 26/26 casos PASS.
- Validador Python incluido en Bash: 26/26 casos PASS.
- IPv4/IPv6 válidas, formatos IPv4 ambiguos, valores fuera de rango, comodines,
  multicast, link-local, interfaces con zona y direcciones IPv4 mapeadas en IPv6.

No se ejecutó el cuerpo de los instaladores, SSH, instalación de paquetes,
WireGuard, reglas de firewall ni cambios de red. No se modificaron los scripts.
F15 continúa BLOCKED para el ensayo real con dos extremos autorizados y SFTP.

El primer control del verificador comparaba texto sin BOM con bytes que sí lo
contenían y detuvo la ejecución. Se corrigió el verificador para comparar los
bytes exactos del archivo; no se retiró el control de integridad.

Evidencia: `wireguard-input-validation.json`.

## Defecto corregido en los informes de auditoría

Se detectaron caracteres de sustitución en tres CSV derivados. La causa se
reprodujo: PowerShell importaba correctamente el texto original, pero su salida
JSON por consola utilizaba la página de códigos **850** y Node la interpretaba
como UTF-8. Las fuentes originales seguían intactas.

Se repararon desde las fuentes UTF-8, sin pasar por ese canal de salida:

| Archivo | Filas | Caracteres de sustitución reparados |
|---|---:|---:|
| `2026-11-10-hallazgos-cierre.csv` | 17 | 21 |
| `2026-11-10-hallazgos-tras-pruebas-locales.csv` | 17 | 21 |
| `2026-11-10-dependencias-cierre.csv` | 54 | 92 |

Se comprobaron unicidad de correspondencia, número de columnas, roundtrip CSV,
conservación de IDs y estados, y ausencia de caracteres de sustitución en los
informes públicos del 9 y 10 de noviembre. Las versiones de dependencias y las
evidencias añadidas permanecen conservadas. No es una reparación de la aplicación
ni cambia la clasificación de las vulnerabilidades.

Evidencias: `encoding-repair.json`, `public-audit-text-scan.json`.

## Nueva comprobación del panel de alumno, exclusivamente en laboratorio

Para preparar la aceptación gráfica pendiente de F17 se creó un caso nuevo en
el laboratorio existente, sin reutilizar ni alterar las siete cuentas originales:

- Perfil: **F17-UI-20261110 Synthetic**.
- ID: `80776b83-6992-441b-a66c-4c4f499c452b`; auth_user 78.
- Práctica: `e06532c8-5e76-41ca-8a4d-8cf703e2c3c6`.
- Resultado teórico: `7d33cf06-a817-4bc7-9a86-126eae10c2c2`.
- Intento: `48838b28-9e7a-48e5-99dc-6b3d4d46fc2e`.

El registro recibió su OTP por el receptor SMTP/TLS sintético existente, sin
reenvío externo. La práctica se creó con 8/10 y el examen de ensayo se finalizó
con respuestas vacías para producir un resultado 0/10, no una aprobación ficticia.
El expediente y sus dependencias quedan cubiertos por recuperación DPAPI con
roundtrip comprobado.

En navegador se comprobó:

- Un resultado teórico y la evaluación práctica con su autor y observaciones.
- Filtro A2 sin resultados teóricos y vuelta a Todos recuperando el resultado A1/A3.
- Actualizar historial práctico mantiene una sola práctica y no duplica filas.

Son **tres controles PASS en laboratorio**, con la misma revisión de lógica de
paneles ya construida. No se presentan como acciones nuevas sobre expedientes
originales ni como prueba de paginación con cientos de registros.

El origen utilizado fue `http://127.0.0.1:18010`, listener de loopback ya existente
y autorizado. Su hostname separa estas cookies de las de localhost. No se cambió
CORS, Compose ni la red. Es HTTP de laboratorio, no HTTPS productivo.

En la preparación, este caso quedó pendiente de autorización específica, sin
ejecutar su borrado. El usuario la concedió posteriormente para ese único perfil.
La [prueba gráfica negativa y positiva](2026-11-10-f17-grafico.md) y su limpieza
selectiva han terminado: F17 PASS en el alcance detallado, sin borrado sobre el
ORIGINAL. El laboratorio vuelve a tener sólo su administrador de control y un
auth_user. La limpieza anterior no se ha repetido ni se han recreado sus usuarios.

Evidencias: `f17-ui-review.json`, `f17-ui-preflight.json`, `f17-ui-ready.png`,
`student-history-ui.json/png`. Credenciales y filas de recuperación sólo en
`f17-ui-private.dpapi`, ignorado por Git.

### Cuatro controles adicionales de alumno

Se ejecutaron en esa misma sesión sintética, sin iniciar otro examen ni modificar
la cuenta o su expediente:

- Material: las cuatro categorías y BOE muestran su estado vacío. Las descargas
  no se validan porque no hay documentos en este laboratorio.
- Evolución: media 0/10 coherente con el resultado y aviso de que hacen falta dos
  intentos para representar una tendencia.
- Buscar sección: escribir «material», elegir el destino y comprobar Material
  abierto con el campo de búsqueda limpio.
- Exámenes: sólo aparece el A1/A3 disponible para este caso, con su última nota
  0/10. No se pulsa Iniciar examen ni se acredita autorización sólo por ocultar A2.

El primer comprobador leyó los resúmenes incrementales «sin cambios» como si
fueran árboles completos y produjo cuatro FAIL aparentes. Se conserva ese
resultado como INVALID del comprobador. Tras capturar los árboles completos,
los cuatro controles son PASS; no se atribuye un defecto a la aplicación.
La matriz CSV se verificó mediante lectura de retorno, esquema y filas exactas.

Evidencias: `student-navigation-ui.json`, `student-exam-catalog-ui.png`.

## Origen público y conservación del ORIGINAL

Desde este equipo, la conexión a
`https://uasspain-prueba.duckdns.org/healthz` se rechazó antes de negociar TLS
(`ECONNREFUSED`). Una consulta independiente por la herramienta web tampoco
obtuvo contenido de esa URL. Esto **no demuestra una caída global ni permite
diagnosticar un certificado público**. Disponibilidad y TLS públicos: BLOCKED.
No se cambió DNS, router, firewall, certificados ni Google Cloud.

El ORIGINAL conserva ocho perfiles; el nuevo ID de F17 no existe en su base.
Las huellas protegidas de perfil, roles, asignación y credenciales de las ocho
cuentas siguen iguales. Cinco contenedores healthy con las mismas imágenes y
fechas de arranque; los cuatro endpoints de salud responden 200 con validación
TLS mediante la CA existente. No hubo escrituras de dominio en el ORIGINAL.

Evidencias: `public-origin-tls.json`, `public-origin-independent-check.json`,
`original-read-integrity.json`.

## Cierre obligatorio de esta continuación

Comprobación final: Gitleaks exit 0, cero coincidencias en el árbol distribuible
con las exclusiones existentes; `git diff --check` y `git diff --cached --check`
exit 0. Los artefactos privados DPAPI permanecen ignorados. Los 19 informes
públicos Markdown/CSV examinados no contienen U+FFFD. La matriz nueva conserva
sus 20 filas al serializar y leer de retorno. No hubo staging, commit ni push.
Evidencia: `final-checks.json`, `gitleaks.json`, `public-audit-text-scan.json`.

```text
SEQUENCE=BLOCKED
CURRENT=VALIDACION_MAESTRA_Y_DEPENDENCIAS_EXTERNAS
NEXT=NOT_RUN
REASON=Origen publico y verificaciones maestras pendientes; F17 grafico cerrado en laboratorio
CHANGE_STATUS=NOT_COMPLETE
RELEASE_GATE=BLOCKED
CODE=PASS reparacion de texto en tres CSV; sin cambios de codigo de aplicacion
TESTS=PASS 8 comprobaciones HTTP,52 entradas IP,7 controles UI de alumno,transporte SMTP y consistencia CSV
DOCKER_BUILD=NOT_RUN; no nuevos inputs de aplicacion, sin reconstruccion de entornos
DOCKER_DEPLOY=UNCHANGED; ajuste de texto previo aun no desplegado en ORIGINAL
POSTGRES=HEALTHY; mismo volumen cifrado
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5 ORIGINAL
HEALTHZ=PASS; HTTP200, TLS CA existente
READYZ=PASS; HTTP200, TLS CA existente
API_LIVE=PASS; HTTP200, TLS CA existente
API_READY=PASS; HTTP200, TLS CA existente
E2E_DOCKER=PASS controles enumerados en su origen; BLOCKED integral
FUNCTIONAL_TEST=PASS alcance ejecutado; F17 GUI y recuperacion transaccional PASS LAB, ver informe especifico
SECURITY=BLOCKED integral; sin reducir protecciones ni registrar valores de cookies
SECRETS_IN_GIT=0 coincidencias Gitleaks del arbol distribuible con exclusiones existentes; artefactos y DPAPI ignorados
COMMIT=NOT_RUN; RELEASE_GATE no superado
PUSH=NOT_RUN; RELEASE_GATE no superado
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779; referencia local sin fetch
CRITICAL=Sin nueva vulnerabilidad confirmada; no dictamen global de ausencia por cobertura pendiente
HIGH=F16 integral y verificaciones pendientes; no se declara cero global
ERRORS=[origen publico; CA estricta; diagnostico ICE/DTLS; envio SMTP externo; OAuth; F15 externo; cobertura maestra; texto previo sin desplegar]
```

Las pruebas anteriores válidas se conservan sin atribuirles una ejecución nueva.
No se declara VALIDATED, PRODUCTION_READY ni listo para entregar al cliente.

# UAS Spain ORIGINAL — estabilidad del frontend y WireGuard local

10 de noviembre de 2026. Continuación del último estado verificado; sin copia del proyecto ni reinicio de auditoría. Evidencias con fecha UTC en `.run/frontend-stability-20261110/` y `.run/f15-f16-20261110/`.

**17 hallazgos históricos: 15 PASS y 2 BLOCKED (F15 y F16). RELEASE_GATE=BLOCKED.** La mejora local no permite declarar VALIDATED ni PRODUCTION_READY.

## Alcance y permisos aplicados

La última instrucción conserva diseño, estructura, controles, estilos, rutas y contratos. Se retiró íntegramente el panel getStats preparado anteriormente antes de desplegarlo: no hay botón ni componente nuevos de videollamada. La respuesta del usuario no autoriza el laboratorio Docker propuesto. No se inició dicho laboratorio ni se crearon cuentas nuevas.

Se aplicó la autorización específica para instalar únicamente wireguard-tools en Kali y crear/retirar el ensayo temporal aislado. La autorización de frontend permite actualizar sólo el contenedor local afectado después de pasar los controles. Se utilizó el arranque oficial con `-Build -Services frontend`; no se reconstruyeron backend, Nginx, PostgreSQL ni Redis. No hubo commit, push, fetch ni despliegue público.

## INSPECT → REPRODUCE → ROOT_CAUSE → FIX → TEST → REGRESSION

| Incidencia comprobada | Causa y reparación mínima | Resultado |
|---|---|---|
| Abrir el acceso cambia el ancho del fondo | El bloqueo del scroll retiraba su barra. Reserva estable del espacio en html. El overlay conserva ancho de viewport para mantener el centrado original. | PASS: variación de 15,199951 px antes a 0 px después, tres ciclos reales sobre Docker |
| «Comprobar disponibilidad» pierde el foco | El efecto borraba el resultado confirmado y desmontaba el botón durante cada petición. Se conserva el resultado durante la comprobación y se bloquean clics repetidos mediante aria-disabled y guardia. | PASS: tres consultas reales HTTP200, foco conservado y coordenadas estables |
| Actualización de configuración Google puede reutilizar una consulta anterior al guardado | La promesa compartida no se invalidaba al recibir el evento de configuración; su finally podía desalojar una consulta más reciente. Invalidación explícita y comprobación de identidad de la promesa. | PASS en pruebas de concurrencia, ambos órdenes de respuesta, deduplicación y recuperación de error |

Los cambios se limitan a googleOAuth.ts, AuthModal.tsx, AuthModalShell.tsx, una propiedad de index.css y cuatro pruebas de googleOAuth.test.ts. No se añaden dependencias, animaciones, transiciones, rutas ni componentes. El acceso convencional no cambia.

Google sigue desactivado por la configuración conservada: la API pública devuelve client_id=null. Esta condición no se presenta como defecto ni se modifica para superar la prueba. La autenticación real con Google habilitado queda BLOCKED por esa configuración y la decisión de no vincular. Las pruebas anteriores de validación del destino/callback OAuth se conservan dentro de la suite actual; no equivalen a autenticación externa real.

## Mediciones y fidelidad visual

- Antes: cuerpo 1264,800049 px cerrado y 1280 px abierto. Después: 1264,800049 px en ambos estados, tres ciclos.
- Modal asentado antes/después: x=416, y=36, ancho=448, alto=648 px. La primera muestra de un ciclo se tomó durante la animación ya existente y no se usa como geometría final.
- Los controles del modal conservan exactamente textos, clases, tamaños, colores, tipografías y alturas/anchos en la comparación DOM guardada.
- Comparación raster del panel de 448×648: 2478 de 290304 píxeles difieren, diferencia máxima de canal 10/255. **No se afirma identidad píxel a píxel.** La superposición y su fondo cambian al estabilizar el documento; el panel oscuro tiene desenfoque de fondo. La geometría y los estilos de los controles sí coinciden.
- Lighthouse estricto: BLOCKED por ERR_CERT_AUTHORITY_INVALID en el navegador de medición. No se usó ignore-certificate-errors, no-sandbox ni modificación de CA. No hay valores válidos de LCP/FCP/TBT/CLS/INP antes/después. El salto geométrico anterior es una medición DOM, no una puntuación CLS.
- React Profiler/DevTools de la sesión integrada: NOT_RUN; no hay una capacidad anunciada para capturar ese perfil. La lectura de Performance API en el ámbito permitido no estaba disponible. No se inspeccionó estado React oculto ni se cambió a una vía interna bloqueada.
- FOUC, rendimiento general y equivalencia visual completa de todos los paneles: NOT_RUN en esta continuación. No se afirman mejoras generales de velocidad ni ausencia global de parpadeos.

Evidencias: before-geometry.json, final-geometry.json, before-controls.json, final-browser-checks.json, retry-request-count.json, panel-pixel-comparison.json, before-modal.png, final-modal.png y final-retry.png. El usuario puede comparar las capturas completas; no se alteraron para ocultar diferencias.

## Pruebas y aplicación local

Typecheck PASS; lint PASS; suite completa 234/234 PASS; build, prerender de diez páginas y verificación de 155 entradas PASS. La cifra anterior 239 correspondía al panel diagnóstico retirado: no describe el código actual.

Dos ejecuciones oficiales parciales completadas con exit0. La segunda conserva el centrado exacto del modal tras detectar una variación lateral en la comparación inicial. Versión final servida a través del Nginx ORIGINAL y coincidente con el contenedor:

- buildId: d35109a9-cfc5-4038-91ed-cd0cdd2151cc
- Imagen frontend: sha256:6d3d58032bd1b559184e284a656ec7cb0ff5177d835a0f13aa1e8bd9557bd577
- Contenedor frontend: 8ea3b92772a0490a8edda5f7ef6ef7e5387294be86861d458fcf1564670f134a

E2E de interfaz real sobre https://localhost: apertura/cierre tres veces, disponibilidad tres veces, foco conservado, Google desactivado correctamente, registro y vuelta, recuperación y vuelta, Escape y recuperación del foco en Acceso: PASS. No se enviaron formularios de registro/recuperación ni se cambiaron contraseñas.

**E2E completo posterior al rebuild: NOT_RUN.** No se traslada a esta versión una nueva ejecución de los anteriores casos multimedia, administrativos o académicos. Los resultados históricos siguen identificados por su origen y versión. Este límite y las mediciones de rendimiento pendientes impiden cerrar el criterio integral de aceptación.

Cinco servicios healthy y cuatro endpoints HTTP200 con CA validada: /healthz, /readyz, /api/health/live/, /api/health/ready/. Los otros cuatro contenedores conservan ID, imagen y arranque. Las ocho cuentas conservan sus huellas de perfil y credenciales. Las 94 entradas backend siguen coincidiendo con r6. No hubo escrituras de dominio de estas pruebas; la comprobación de cifrado del arranque oficial superó protección del volumen, clave incorrecta y ausencia de mount persistente en claro. No se atribuye aquí un nuevo barrido íntegro de expedientes.

Evidencias: vitest-final.json, final-runtime.json, final-source-deployment-proof.json, navigation-regression.json y salida verificada del arranque oficial.

## F15 — ensayo WireGuard/SFTP real autorizado

PASS local: wireguard-tools 1.0.20260223-2 instalado en Kali. Dos namespaces con interfaces y claves efímeras; handshake reciente en ambos extremos, ruta seleccionada wg0, transferencia SFTP de sólo lectura y hash igual, corte del túnel impide transferencia y recuperación permite nueva lectura idéntica. Contadores observados: 15832/15772 y 15624/15832 bytes RX/TX.

El proceso SFTP temporal sólo escuchó dentro del namespace. No se editó authorized_keys del usuario ni el servicio SSH principal; no se cambiaron firewall ni rutas principales. El trap verificó invariancia de rutas, PID y configuración SSH al retirar el ensayo. La lectura posterior confirma cero namespaces y directorios temporales propios, SSH active/enabled y known_hosts idéntico. El paquete aprobado permanece instalado.

La primera invocación sólo imprimió PLAN_ONLY por faltar el argumento: no se cuenta como ejecución real. La segunda, con --apply, exit0 y todos los marcadores, es la evidencia de aceptación local. Las credenciales sólo pasaron por memoria/entrada privada del proceso; no figuran en archivos, argumentos ni informes. Las identidades SSH retiradas no se utilizaron.

Evidencias: wireguard-first-invocation-plan-only.json, wireguard-approved-real-result.json, kali-wireguard-postcleanup-readonly.json. Se conservan las regresiones anteriores de los scripts: 46 casos PS5, 46 PS7 y 36 Bash; no se presentan como nueva ejecución ni como instalación real de esos scripts en Windows.

**F15 global BLOCKED:** faltan dos servidores Linux externos administrables y autorizados, incluida persistencia/reversión en esos extremos. El ensayo usa WireGuard real dentro de una única VM y no sustituye esa aceptación.

## F16 y auditoría restante

**F16 BLOCKED:** sigue sin evidencia directa del par ICE seleccionado, DTLS y contadores RTP de una llamada real de UAS Spain. No se eludió la restricción del navegador ni se instaló/configuró STUN/TURN. Se retiró la nueva interfaz diagnóstica según la orden de conservar el diseño. La cámara real, audio audible confirmado por el usuario, WSS, aislamiento y reconexiones anteriores se conservan como evidencia histórica; no se atribuyen a una nueva llamada contra el frontend reconstruido.

Se mantiene el alcance maestro: integración SMTP externa, CA estricta, Google real conservado desactivado, rendimiento, E2E completo y demás verificaciones maestras no acreditadas siguen pendientes según su matriz. Los PASS previos no se reinician ni se convierten en ejecuciones nuevas. Matrices vigentes: 2026-11-10-hallazgos-vigentes.csv y 2026-11-10-f15-f16-verificacion.csv.

## Cierre obligatorio — sección 25

```text
SEQUENCE=BLOCKED
CURRENT=METRICAS_FRONTEND_E2E_INTEGRAL_F15_EXTERNOS_F16_ICE_DTLS
NEXT=NOT_RUN
REASON=Reparaciones locales comprobadas; criterios integrales pendientes sin reducir alcance
CHANGE_STATUS=NOT_COMPLETE
FRONTEND_FIX_STATUS=APPLIED_TESTED_DOCKER
RELEASE_GATE=BLOCKED
CODE=PASS reparaciones acotadas; panel diagnostico retirado
TESTS=PASS 234/234, typecheck, lint, build y prerender
DOCKER_BUILD=PASS frontend solamente mediante procedimiento oficial
DOCKER_DEPLOY=PASS local frontend; otros cuatro servicios intactos
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
E2E_DOCKER=PASS casos acotados acceso/disponibilidad/navegacion; completo NOT_RUN
FUNCTIONAL_TEST=PASS estabilidad/foco/disponibilidad y WireGuard-SFTP local real; Google habilitado e ICE-DTLS BLOCKED
SECURITY=BLOCKED integral; protecciones conservadas; analisis de secretos en evidencia final
SECRETS_IN_GIT=0 coincidencias Gitleaks en arbol distribuible con exclusiones existentes; final-checks.json; sin afirmar todo el historial
COMMIT=NOT_RUN prohibido por ultima instruccion
PUSH=NOT_RUN prohibido por ultima instruccion
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779 referencia local sin fetch
CRITICAL=Sin cero global por verificaciones obligatorias pendientes
HIGH=F16 BLOCKED; sin cero global
ERRORS=[CA medicion automatizada, E2E completo pendiente, F15 externos, F16 ICE-DTLS, verificaciones maestras pendientes]
```

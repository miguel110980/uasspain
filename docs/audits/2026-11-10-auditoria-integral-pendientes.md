# Auditoría integral: alcance, evidencias y pendientes actuales

10 de noviembre de2026. Contraste del plan maestro actualizado con los informes del ORIGINAL y sus laboratorios, después del catálogo común y la actualización completa de Docker. **AUDIT_STATUS=INCOMPLETE. RELEASE_GATE=BLOCKED. GITHUB=BLOCKED para la entrega definitiva.**

## Conclusión

La auditoría sigue siendo integral. Los17 hallazgos anteriores conservan15PASS y2BLOCKED(F15/F16). Ese inventario de defectos no constituye el cierre del plan maestro: hay controles, integraciones, TLS y mediciones aún pendientes. No se declara el sistema listo para cliente o producción.

El catálogo ya se observa en la web del ORIGINAL con Alumno Prueba local: diez materiales, con sus bloqueos. Los cinco alumnos reciben los mismos diez y sólo el alumno con la concesión existente descarga su documento. Docker está actualizado y comprobado. Véase2026-11-10-catalogo-todos.md.

## Pendientes que no se deben omitir

1. **Todos los controles y sus variantes:** el inventario fuente contiene441 entradas(220admin,59instructor,39alumno,123compartido/público), todas sin cierre de ejecución asociado en ese CSV. Muchas acciones tienen casos reales ya probados en otras matrices, pero no hay trazabilidad exhaustiva control→caso→API/almacenamiento→evidencia. La navegación de20/11/8 secciones no demuestra cada acción interna. Se detecta además una aserción de LiveConnectionActions.test.tsx incluida como control: no es una acción del producto; se debe clasificar N/A al depurar la matriz, conservando la entrada original. Tampoco se deben tratar filas generadas/repetidas como un número demostrado de acciones únicas.
2. **Google real en el ORIGINAL:** continúa deshabilitado y sin vincular conforme a la decisión del titular. Configuración o botón comprobados no sustituyen el acceso real por rol, alta nueva, cancelación, usuario pendiente y cuenta bloqueada. No se activa ni vincula automáticamente para conseguir un PASS.
3. **Correo real del proveedor:** la negociación STARTTLS y el circuito SMTP del laboratorio tienen evidencia. Falta una nueva entrega externa/AUTH E2E al destinatario autorizado. No se envían correos reales sin alcance/destino definidos ni se cambian contraseñas o configuración activa.
4. **TLS local y Firefox:** CA existente con error92 estricto por falta de keyUsage; la confianza importada no ha cerrado el aviso Firefox. Hace falta diagnosticar el motivo concreto y una reparación criptográfica revisable con reversión y aprobación específica antes de cambiar certificados/confianza/servicios reales. No se ha rotado ninguna clave.
5. **WebRTC(F16):** conservar prueba histórica real de cámara/vídeo y confirmación del audio en ambos sentidos. Falta evidencia directa de ICE seleccionado, DTLS y RTP. La prueba local no acredita NAT/TURN público. El alcance de dos redes físicas fue sustituido por el titular por un equipo/red para esta fase; la validación pública del cliente permanece en fase posterior.
6. **WireGuard/SFTP externo(F15):** Windows↔Kali y WireGuard real local entre namespaces sí tienen evidencia, sin reemplazar los dos extremos externos que faltan. Persistencia/reinicio/reversión bilateral siguen sin validación externa. No se instalaron servicios ni se abrieron puertos nuevos en esta continuación.
7. **Rendimiento completo:** hay mediciones públicas y estabilidad de zonas reparadas; falta INP, ReactProfiler y evaluación de todos los paneles/escenarios exigidos. Un baseline público bueno no acredita esas interacciones.
8. **Backups:** no se pierde la evidencia PASS de copias full/incrementales cifradas y recuperación real aislada. La revisión actual no aporta cierre exhaustivo por control del asistente, programación y retención; debe acreditarse en la matriz integral. No corresponde restaurar producción para demostrarlo.
9. **Dominios/validación externa:** tres alias permanecen bloqueados por TLS pendiente. La prueba local con SNI público válido no demuestra acceso WAN ni habilita cambios de DNS, limpieza de hosts o despliegue público. La sección16 del plan es posterior y exige su autorización propia.
10. **Entrega final/GitHub:** el permiso vigente es subir cuando esté todo listo. Permanecerá pendiente el nuevo commit/push mientras no se cumpla el gate. La rama de trabajo publicada antes por excepción limitada no acredita release, y no se extiende esa excepción a estos cambios nuevos.

## Fallo adicional confirmado y corregido durante esta revisión

Los dos entregables autónomos del escritorio se conservan separados de los scripts internos. Sus contenidos distintos no son un fallo: el coordinador autónomo pide primero las dos IP y no depende del repositorio. Sin embargo, su bloque remoto verify aceptaba una marca de tiempo de handshake futura y podía ignorar la salida de error de wg/ip al usar pipelines; la comprobación de interfaz también aceptaba prefijos. Se reprodujeron seis falsos positivos iniciales de los tres primeros escenarios en ambos archivos sin SSH ni red real.

Se corrigieron únicamente esas comprobaciones: fecha reciente no futura y numérica, códigos de salida independientes y nombre exacto de interfaz.24 casos aislados, parsing PowerShell5.1/7 y Bash PASS, con registro de hashes de ambos entregables. No se ejecutó el coordinador ni se instalaron herramientas, se alteró firewall, se crearon túneles o se tocaron claves. **No convierte F15 externo en PASS.** Evidencia: .run/catalogo-todos-20261110/standalone-verify-before.json y standalone-vpn-tests.json; prueba reproducible scripts/security/test-standalone-vpn.mjs.

## Trazabilidad del alcance

La tabla2026-11-10-alcance-maestro-estado.csv enumera registro/OTP, expedientes/reasignación, documentos, exámenes, materiales, chat, cuentas/borrado, backups, Google, SMTP, TLS, Firefox, WebRTC, VPN, scripts independientes, controles de los tres paneles/público, rendimiento, infraestructura, dependencias, dominios y publicación. Los PASS se limitan a los casos y versiones acreditados; la columna pendiente explica qué queda por completar. No se interpreta falta de evidencia como fallo reproducido ni se convierte una prueba no ejecutada en PASS.

Los resultados antiguos se conservan con su fecha/alcance, y se resuelven por evidencia posterior: por ejemplo F17 gráfico y recuperación local ya no se consideran bloqueados a partir de sus ensayos posteriores. La autorización condicionada de Git no cambia el alcance de producción ni el requisito de permisos específicos para datos reales, certificados, red o borrados.

**Cierre de esta revisión:** catálogo visible y contenedores comprobados; verificador autónomo reparado; inventario integral de pendientes documentado. La auditoría integral sigue incompleta y no se emite dictamen positivo de entrega.

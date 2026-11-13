# Auditoría integral pendiente después del acceso Google real

Este estado combina la matriz maestra histórica de 22 áreas con la evidencia posterior del ORIGINAL. No sustituye ni elimina los casos y alcances anteriores. El inventario de 17 defectos y el inventario de controles tienen finalidades distintas; no se deduce el cierre integral de un número de hallazgos reparados.

## Cierres posteriores acreditados

- Google local del administrador: PASS. Verificación auténtica, activación y vínculo autorizados, entrada por el botón público, retorno a administrador con identidad correcta. Ocho perfiles conservados por recuento. Véase `2026-11-12-google-oauth-local.md`.
- Encabezados compartidos: PASS en la versión Docker, acceso de instructor/alumno, menú de cuenta, navegación y menú móvil, TLS estricto en Edge y buscador retirado. El administrador también se observó directamente.
- Salud del ORIGINAL: cinco servicios saludables y cuatro HTTP 200 después del acceso real con Google. No equivale a cierre integral.
- HTTPS local y confianza Windows/Edge: PASS, validación normal sin excepciones y navegador en estado seguro acreditados después de importar la CA existente autorizada. Se conserva además la confirmación del titular de que el problema del certificado está solucionado. No se vuelve a presentar la conexión HTTPS local como defectuosa por una limitación de nuestra herramienta de control de Firefox.
- Ubuntu físico: se conservan SSH/SFTP y comprobación integrada con ida/vuelta PASS, así como la observación periódica. La caída tras reinicio se recuperó al reconectar manualmente Internet del teléfono. Su apagado posterior fue decisión del titular; no se repiten pruebas ni se considera regresión en esta fase.
- Backups: se conservan los PASS de copia cifrada full/incremental, verificación y recuperación aislada; la base activa quedó preservada. El titular confirma que este bloque ya se realizó y lo retira de esta ronda. No se repiten restauraciones, programación ni operaciones remotas para esta continuación.
- Paneles y permisos: existen 108 comprobaciones de lectura/acceso ya acreditadas, además de los casos de admisión y recursos. La tabla siguiente se refiere a cobertura y trazabilidad todavía no enlazadas, no a ausencia de todas las pruebas.

La revisión solicitada por el titular recupera específicamente `integrated-success.json` (comprobación de la aplicación PASS), `transfer-proof.json` (ida/vuelta SFTP con igualdad de bytes), `monitor-samples.json` (renovaciones firmadas) y `header-browser-e2e.json` (TLS estricto de Edge, entorno seguro y ambos paneles). Son evidencias de trabajo ya terminado, no tareas que haya que repetir. La captura genérica del estado del escritorio sólo mostró este chat y sus pestañas laterales; no se le atribuye una inspección directa nueva de Firefox.

## Pendientes y límites vigentes

| Área | Estado | Comprobación que queda |
|---|---|---|
| Cobertura integral de controles | NOT_RUN | Relacionar cada acción y estado de administrador, instructor, alumno y páginas públicas con prueba, API, permiso, persistencia y evidencia. El CSV fuente contiene 441 entradas de código, no 441 acciones únicas ya verificadas; requiere depuración y trazabilidad. |
| Variantes Google OAuth | NOT_RUN | Alta nueva, cancelación, pendiente/bloqueo y variantes por rol con proveedor real. El acceso local de Miguel sí está cerrado. |
| SMTP externo | NOT_RUN | AUTH y entrega externa E2E al destinatario autorizado. STARTTLS y correo de laboratorio previos siguen PASS en su alcance. |
| Compatibilidad estricta de la CA, caso separado de HTTPS operativo | FAIL | Repetido ahora en sólo lectura: `openssl verify -x509_strict -CAfile .secrets/tls/ca.crt .secrets/tls/edge.crt`, salida 1, error 92 porque falta keyUsage en la CA. El certificado raíz actual mantiene la misma huella y carece de esa extensión. No se modifica ni se reemite. Este resultado específico no revoca los PASS de confianza Windows/Edge ni la confirmación del titular. |
| Rendimiento de todos los paneles | NOT_RUN | Mediciones de interacciones, INP, React Profiler y escenarios completos; se conservan los resultados públicos y locales anteriores en su alcance. |
| Diagnóstico multimedia manual | NOT_RUN | ICE seleccionado, DTLS y RTP directos no certificados. Cámara/vídeo reales y audio audible históricos se conservan. El titular lo excluyó de la validación automática de esta fase; no se convierte en PASS ni en nuevo bloqueo de OAuth. |
| Dominios y validación pública/WAN | NOT_RUN | Fase externa posterior del plan, con alcance y autorización propios. El acceso Google local no demuestra un despliegue público. |
| Cierre de seguridad y entrega | NOT_RUN | Consolidar revisión de dependencias, secretos, regresiones y evidencias actuales; completar Modo Producción y Git conforme a los gates autorizados. No se declara cero crítico/alto sin la revisión pendiente. |

Los registros históricos de registro/OTP, expedientes, documentos, exámenes, materiales, chat, borrado sintético y recuperación aislada se mantienen; no se presentan como nuevas ejecuciones. Las ocho cuentas y los volúmenes no se han borrado o recreado durante OAuth.

## Límites operativos y trabajo adicional, separados de incidencias resueltas

La VPN y su transporte SFTP al único Ubuntu autorizado quedan como PASS en el alcance funcional comprobado. No se pide encender Ubuntu ni repetir la prueba. Su conexión al teléfono necesitó intervención manual tras el reinicio; no se certifica arranque sin esa intervención ni se usa como fallo actual de VPN. Las condiciones antiguas de dos servidores externos no se vuelven a imponer a la fase de un único anfitrión autorizada por el titular.

Aplicar desde el panel cambios reales del túnel es trabajo adicional iniciado: el transporte backend está preparado, pero el ejecutor y la integración no están terminados. Se conserva como implementación incompleta, separada del funcionamiento VPN ya verificado; no se declara entregada ni se presenta como una nueva avería de conectividad.

`AUDIT_STATUS=INCOMPLETE`. `RELEASE_GATE=BLOCKED`. No hay dictamen de producción ni entrega definitiva. Las pruebas pendientes se distinguen de defectos reproducidos.

La publicación de trabajo pendiente en la rama de auditoría es una excepción ya autorizada por el titular, distinta de la entrega definitiva condicionada al gate. No supone publicar una aplicación, cambiar producción ni convertir comprobaciones no ejecutadas en PASS.

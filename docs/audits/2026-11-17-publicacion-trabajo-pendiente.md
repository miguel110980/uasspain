# Publicación de reparaciones y auditoría en curso

Rama: `codex/auditoria-20261110`. Esta publicación conserva el estado de trabajo pendiente; no es una declaración de preparación para producción.

## Cambios incluidos

- Importación de exámenes: conservación del formato enriquecido PDF/DOCX/DOC, reconocimiento de respuestas marcadas, previsualización con numeración original y rechazo íntegro de importaciones ambiguas.
- Publicaciones BOE: integración en el listado público y filtros de publicación/fecha, conservando la protección del contenido privado.
- Videollamadas: aviso de llamada entrante, rechazo, recuperación de señalización y medios tras pérdida de red y conservación del estado de cámara/micrófono.
- Despliegue: configuración ICE mediante archivo, enlace HTTPS LAN opcional y actualización de las capas de paquetes de las imágenes locales.
- Scripts de inspección, regresión y validación usados durante la auditoría. Sus ensayos con escrituras requieren los fixtures y permisos correspondientes; no ejecutar indiscriminadamente sobre datos reales.

## Verificaciones acreditadas

| Área | Resultado y alcance |
| --- | --- |
| Frontend | Typecheck, lint y 248 tests superados; comprobaciones repetidas antes de esta publicación. Build anterior superado. |
| Backend | fmt/check/clippy y 178 tests superados en la imagen de auditoría; cinco tests de entorno ignorados en la ejecución normal. Se reutiliza esta ejecución anterior. |
| API de las reparaciones | 171 comprobaciones superadas en laboratorio aislado. |
| Interfaz de las reparaciones | Once comprobaciones superadas sobre los contenedores del laboratorio. |
| Vídeo real local | Administrador/instructor en contextos independientes: vídeo local/remoto distinto, ICE/DTLS y RTP en ambos sentidos, controles y reconexión. |
| Regresión sobre el ORIGINAL actualizado | Instructor/alumno locales: vídeo real, reconexión y finalización de todas las pistas al colgar. |
| Autorización | Acceso HTTP y WSS denegado a usuarios ajenos a una llamada activa. |
| Chat | Ocho comprobaciones con mensajes, historial, reconexión y aislamiento en laboratorio. |
| Conservación | Cuentas, credenciales, roles, claves y tablas académicas sin cambios durante las reparaciones. Cuatro cuentas sintéticas del laboratorio desactivadas, sin borrados. |
| Imágenes | Los cinco servicios estaban saludables tras la aplicación oficial. Escaneos anteriores de las cinco imágenes sin hallazgos HIGH/CRITICAL. |

Los resultados anteriores corresponden a las ejecuciones documentadas del 17 de noviembre. Docker no estaba disponible al preparar esta publicación: no se presenta una nueva comprobación de salud ni un nuevo despliegue.

## Incidencias pendientes

- **FAIL — llamada real entre administrador externo e instructor local:** el usuario sólo recibe su cámara o un recuadro negro. El instructor adquiere cámara y micrófono y se intercambian oferta, respuesta y candidatos ICE, pero la conexión con el participante falla. El transporte externo sigue sin resolverse; sólo hay STUN configurado, sin TURN. No se ha demostrado todavía qué restricción concreta de red causa el fallo.
- **BLOCKED — aceptación multimedia externa:** falta acreditar vídeo estable y audio audible en ambos sentidos, además de reconexión entre esas redes físicas. Las pruebas locales no sustituyen este criterio.
- **BLOCKED — STS 3:** cuatro preguntas del PDF inspeccionado no tienen una respuesta marcada inequívocamente; se bloquea la confirmación sin inventar soluciones. STS 1 y STS 2 producen 40 preguntas válidas cada uno.
- **BLOCKED — comprobación estricta de HTTPS literal localhost:** reserva conocida del validador local, separada del certificado del dominio público. No se han evitado controles ni cambiado la CA para superar la prueba.

Las evidencias originales y capturas operativas se conservan localmente. No se incluyen en esta publicación datos académicos, secretos ni capturas de sesiones personales. El resumen distingue expresamente resultados locales y externos.

```text
PUBLICATION=WORK_IN_PROGRESS
EXTERNAL_VIDEO=FAIL
AUDIT_ACCEPTANCE=BLOCKED
CHANGE_STATUS=NOT_COMPLETE_PENDING_EXTERNAL_ACCEPTANCE
RELEASE_GATE=BLOCKED
PRODUCTION_READY=NOT_DECLARED
```

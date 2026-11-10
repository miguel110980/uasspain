# UAS Spain — plan concreto de desbloqueo F15/F16

> **Plan histórico sustituido por la última instrucción del usuario.** El panel
> getStats descrito abajo se retiró antes de desplegarlo para conservar la
> interfaz. No existe actualmente ese botón ni se autoriza aquí el laboratorio
> Docker propuesto. El laboratorio temporal de Kali sí fue autorizado, ejecutado
> y retirado: WireGuard/SFTP local PASS. Estado vigente y límites:
> [cierre de frontend y WireGuard](2026-11-10-frontend-estabilidad-wireguard.md).

10 de noviembre de 2026. Preparación completada; operaciones de infraestructura
pendientes de autorización específica. **CHANGE_STATUS=NOT_COMPLETE;
RELEASE_GATE=BLOCKED.** No se ha instalado WireGuard ni actualizado Docker.

## F16: diagnóstico implementado y comprobado en código

La videollamada dispone ahora en el código fuente de un botón opcional
«Estado de la conexión». Activarlo consulta getStats de las conexiones creadas
por la propia aplicación, cada dos segundos. Muestra:

- Estado de conexión e ICE.
- Par ICE realmente seleccionado por el transporte, protocolo y tipos de candidatos.
- Estado DTLS, versión y cifrados DTLS/SRTP cuando el navegador los informa.
- Bytes de audio/vídeo enviados y recibidos y fotogramas codificados/decodificados.
- Fecha de medición. Ausencias, ceros y errores se distinguen explícitamente.

Se conservan sólo esos campos; no se retienen direcciones, puertos, SDP,
certificados, credenciales ni IDs de candidatos. La medición se detiene al
desactivar el panel o cerrar la llamada y se descarta al retirar un participante.
No cambia autenticación, permisos, señalización, ICE configurado ni adquisición
de cámara/micrófono. El código utiliza la
[API de estadísticas WebRTC del W3C](https://www.w3.org/TR/webrtc-stats/).

Archivos:

- `frontend/src/lib/webrtcDiagnostics.ts` y sus pruebas.
- `frontend/src/hooks/useWebrtc.ts`.
- `frontend/src/components/videollamada/Videoconferencia.tsx` y sus pruebas.

Verificación ejecutada:

| Gate host | Estado |
|---|---|
| Typecheck | PASS |
| Lint completo | PASS |
| Nueve pruebas específicas de datos, privacidad e interfaz | PASS |
| Regresión frontend completa | PASS, 239/239, 23 archivos |
| Build + prerender + comprobación de assets | PASS |
| Nueva interfaz dentro de Docker | NOT_RUN |
| ICE/DTLS/RTP reales con esta interfaz | NOT_RUN |

Evidencias en `.run/f15-f16-20261110/f16-diagnostics-*.log`.
Estos PASS son de código/host. F16 permanece BLOCKED hasta comprobar una llamada
real con esta revisión en Docker y obtener sus mediciones, sin usar datos simulados
como aceptación multimedia.

### Operación de laboratorio propuesta

Actualizar exclusivamente la imagen frontend del laboratorio existente
`uasspain-mail-audit-closure-630870e0` y arrancar sus componentes propios parados,
incluido su receptor SMTP sintético previamente existente si hace falta.
Se conservan los listeners de loopback ya configurados: 18010 y 18444.
No se publica un servicio nuevo ni se modifica la pila permanente `uasspain`.

El PostgreSQL del laboratorio usa tmpfs: puede requerir inicialización de sus
fixtures al arrancar tras la parada anterior. Sólo datos sintéticos nuevos,
sin restauración/copia de la base real, sin copiar las siete cuentas ni sus
contraseñas. Crear hasta un instructor y dos alumnos sintéticos nuevos;
desactivarlos al acabar, sin borrar registros anteriores.

Prueba prevista: dos clientes independientes del laboratorio, cámara/micrófono
reales, observación de las mediciones locales en ambos sentidos, crecimiento de
contadores, audio/vídeo, reconexión y revocación/aislamiento. Se conservarán sólo
las evidencias mínimas de aceptación; no se grabará audio/vídeo.

La actualización de la instancia ORIGINAL no está incluida en esta autorización
propuesta. Su gate de despliegue se mantendrá pendiente.

## F15: WireGuard real temporal dentro de Kali

SSH y SFTP Windows→Kali ya son PASS con comprobación estricta de host y lectura
real de un archivo público. Kali no dispone de wg/wg-quick. El usuario prohibió
instalar servicios, abrir puertos o modificar red sin autorización específica.

Para avanzar con menos impacto se propone probar WireGuard real dentro de dos
espacios de red temporales de la VM Kali; es un
[uso soportado de network namespaces por WireGuard](https://www.wireguard.com/netns/).
No requiere instalar el controlador WireGuard en Windows ni cambiar VMnet8,
router, DNS, firewall, rutas del portátil o la configuración SSH principal.

Payload preparado para revisión:
`.run/f15-f16-20261110/kali-wireguard-isolated-lab.sh`.
Por defecto sólo muestra PLAN_ONLY. Su sintaxis Bash y ese modo sin efectos se
han ejecutado correctamente. **No se ha ejecutado --apply ni sus operaciones root.**

### Cambios exactos que requerirían permiso

1. Ejecutar como administrador en Kali por la conexión SSH ya verificada.
2. Actualizar índices e instalar únicamente `wireguard-tools`, desde repositorios
   ya configurados y sin upgrade general. Si la simulación de apt pide cambios
   adicionales de paquetes, parar antes de instalarlos. Las herramientas quedarán
   instaladas; no se hará desinstalación automática ni autoremove.
3. Crear namespaces `uas15-<nonce>-a/b` y una pareja veth propia. Underlay interno
   192.0.2.1/30–192.0.2.2/30; overlay 198.18.255.1/30–198.18.255.2/30. Sin ruta por
   defecto, NAT, forwarding ni reglas de firewall nuevas. La creación de WireGuard
   puede cargar el módulo del kernel de Kali; si el kernel no lo soporta, parar.
4. Crear wg0 dentro de cada namespace y claves nuevas efímeras protegidas en un
   directorio propio `/run/uas-f15-wg.*`; UDP 51821 sólo en esos espacios de red.
5. Arrancar un proceso sshd temporal dentro del segundo namespace, ligado sólo
   a 198.18.255.2:22222, con claves propias y SFTP de sólo lectura forzado. Usará
   el usuario kali y un archivo temporal de clave pública: no modifica su
   authorized_keys, contraseñas, host keys o servicio SSH existentes.
6. Verificar handshake reciente de ambos peers, ruta por wg0, transferencia SFTP
   y hash; bajar sólo el wg0 propio y exigir fallo de transferencia; reactivarlo
   y exigir recuperación. Consultar contadores reales de WireGuard.
7. Retirar sólo el proceso, namespaces, interfaces y archivos/claves temporales
   de esta ejecución. Verificar identidad/procedencia antes de cada retirada y
   comprobar que rutas principales, PID SSH principal y sshd_config permanecen
   iguales. Si hay una diferencia ajena, no sobrescribirla para forzar un PASS.

No se modifica ni borra información del ORIGINAL ni se usan sus credenciales.
No se abren listeners en las interfaces normales de Kali/Windows. Los dos
namespaces comparten VM, kernel y filesystem: **no son dos servidores externos**.
La prueba no acreditará persistencia tras reiniciar máquinas externas ni NAT/TURN.
F15 conservará BLOCKED en esos criterios externos no disponibles.

## Stop conditions y aceptación

Detener la operación afectada ante identidad SSH distinta, autenticación fallida,
falta de sudo autorizado, dependencias adicionales no previstas, kernel sin
WireGuard, colisión con un recurso existente, datos ajenos al laboratorio,
integridad alterada, fuga de secretos o fallo de limpieza. Conservar evidencias
y continuar sólo verificaciones independientes permitidas.

Los cinco contenedores y las ocho cuentas del ORIGINAL deben mantenerse intactos.
No se autoriza commit, push, despliegue del ORIGINAL, cambios de certificados,
configuración de STUN/TURN ni recursos externos de pago.

Hasta la autorización y ejecución real:

```text
SEQUENCE=BLOCKED
CURRENT=APROBACION_OPERACIONES_LABORATORIO
NEXT=NOT_RUN
REASON=Instalacion/red Kali y actualizacion Docker de laboratorio requieren permiso especifico
CODE=IMPLEMENTED_TESTED diagnostico F16; scripts F15 previamente reparados y probados
TESTS=PASS 239 frontend y gates host; plan/sintaxis laboratorio PASS
DOCKER_BUILD=NOT_RUN
DOCKER_DEPLOY=NOT_RUN
POSTGRES=HEALTHY ORIGINAL
REDIS=HEALTHY ORIGINAL
BACKEND=HEALTHY ORIGINAL
FRONTEND=HEALTHY ORIGINAL
NGINX=HEALTHY ORIGINAL
CONTAINERS_HEALTHY=5/5 ORIGINAL
HEALTHZ=PASS HTTP200 CA existente
READYZ=PASS HTTP200 CA existente
API_LIVE=PASS HTTP200 CA existente
API_READY=PASS HTTP200 CA existente
E2E_DOCKER=NOT_RUN nueva revision
FUNCTIONAL_TEST=BLOCKED mediciones reales pendientes
SECURITY=BLOCKED integral; privacidad de diagnosticos y gates host PASS
SECRETS_IN_GIT=0 coincidencias Gitleaks del arbol distribuible con exclusiones existentes
COMMIT=NOT_RUN
PUSH=NOT_RUN
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779; referencia local sin fetch
CRITICAL=Sin dictamen global por verificaciones pendientes
HIGH=F16 BLOCKED hasta mediciones reales y gates aplicables
ERRORS=[aprobacion de infraestructura; llamada real con diagnosticos; WireGuard real; extremos externos; cobertura maestra]
CHANGE_STATUS=NOT_COMPLETE
RELEASE_GATE=BLOCKED
```

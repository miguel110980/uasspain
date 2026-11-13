# Catálogo publicado para todos los alumnos

10 de noviembre de 2026. Aclaración funcional expresa del titular: todos los alumnos deben ver todos los materiales publicados del catálogo, con acceso individual bloqueado o desbloqueado. **Sustituye el criterio anterior que exigía asignación para mostrar la ficha.** La asignación sigue siendo necesaria para leer el contenido.

## Resultado del ORIGINAL

| Cuenta | Publicados visibles | Bloqueados | Desbloqueados |
|---|---:|---:|---:|
| Alumno Prueba local |10|10|0|
| Alumno Prueba 2 |10|10|0|
| Alumno Prueba 3 |10|10|0|
| Alumno Prueba 4 |10|10|0|
| Alumno Prueba 5 |10|9|1|

Se autenticaron las cinco cuentas y se compararon los ID de sus diez materiales: catálogo idéntico. Se observó directamente el panel de Alumno Prueba local en el ORIGINAL pasando de cuatro estados vacíos a diez fichas bloqueadas, sin categorías vacías. La captura alumno-local-viewport.png acredita la representación real; no se usa sólo el200 de la API como prueba de interfaz.

Las cuatro categorías existentes son A1/A3,A2,STS y Radiofonista. El material concedido sigue descargando10680174 bytes de PDF con el mismo SHA256 anterior. Se verificaron98 combinaciones de detalle/archivo de los49 materiales bloqueados entre los cinco alumnos, todas404 al comprobar autorización. La primera ráfaga excedió el límite existente y produjo429; sus11 registros se repitieron a10 peticiones/s hasta obtener las respuestas de autorización, sin modificar Nginx ni desactivar protecciones. Ambas evidencias se conservan.

## Reparación y protección

- academic_scope.rs: publicación activa controla la inclusión en la lista; no se exige registro personal de permiso para mostrar la ficha. Se mantiene resource_scope para recursos privados de otros instructores.
- materials.rs actualiza la llamada del filtro. Mantiene bloqueado según concesión positiva y denegación prevalente, y la lista positiva de metadatos permitidos cuando está bloqueado.
- Detalles, archivos, extracción y progreso siguen protegidos. Inactivos/borradores y recursos privados ajenos siguen ocultos. No se concedieron permisos, no se editaron matrículas ni se cambiaron datos reales.
- El frontend no necesita otro cambio: utiliza los mismos controles y clases ya verificados. Se mantiene su buildId a86d8b10-4d1d-484f-8108-00f9e37f11d9.

169 pruebas Rust,fmt,check,Clippy e aislamiento del conversor PASS. Cuatro pruebas ignoradas no se cuentan como ejecutadas. Suite de catálogo ampliada:87 casos PASS en el laboratorio existente, incluyendo publicado sin asignación visible bloqueado y sus operaciones denegadas. Se reutilizaron las tres cuentas sintéticas anteriores, sin crear cuentas nuevas. Se retiró su activación al terminar, conservando todos los registros; sin borrados.

## Actualización real

Tras los gates se actualizó backend mediante el arranque oficial -Build y después se ejecutó el arranque oficial completo -Build para comprobar todos los cambios locales del día. Ambos terminan con salida0. Backend recreado; cinco servicios saludables. Binario del ORIGINAL idéntico al de la imagen runtime ensayada. Los demás inputs siguen vigentes y Docker reutiliza la caché cuando corresponde; no se inventa recreación de imágenes que no han cambiado.

Cuatro endpoints de salud200 con validación TLS,30 controles CA/routing PASS. Huellas de las ocho cuentas, trece tablas académicas, clave DPAPI y migración34 iguales al inicio. No se crearon copias de proyecto ni se modificaron volúmenes, claves, redes o Compose del ORIGINAL.

Evidencias: .run/catalogo-todos-20261110/{before.json,all-students.json,allowed-download.json,catalog-test.json,backend-audit.log,original-update.log,full-original-update.log,final-proof.json,alumno-local-after.txt,alumno-local-after.png,fixture-retirement.json}. Las capturas y los artefactos locales no se añaden a Git.

## Revisión integral solicitada

La auditoría no termina en materiales. El inventario actual de pendientes y el contraste con el plan maestro están en2026-11-10-auditoria-integral-pendientes.md. Se conservan los17 hallazgos:15PASS y2BLOCKED(F15/F16); no se confunde ese resultado con cobertura íntegra de todos los controles.

Al revisar los entregables externos se reprodujeron falsos positivos del verificador de ambos scripts independientes de VPN del escritorio ante fecha futura y errores de comandos. Se corrigieron en esos dos archivos sin ejecutar sus coordinadores ni cambiar redes/instalar herramientas.24 regresiones puras PASS; parsing PowerShell5.1/7 y Bash PASS. Ese arreglo del verificador no sustituye los dos servidores externos que faltan. Los scripts independientes no deben reemplazarse por infra/wireguard/setup.*, porque tienen distinta interfaz y deben ser autónomos. Sus hashes distintos son esperables.

## Cierre obligatorio

```text
CODE=PASS catálogo publicado independiente de asignación; verificador de scripts independientes reparado
TESTS=PASS 169 Rust,87 catálogo,98 combinaciones autorización,30 routing/CA,24 verificador VPN;4 ignoradas NOT_RUN
DOCKER_BUILD=PASS arranque oficial parcial y completo salida0; frontend244 previas retenidas sin nueva ejecución
DOCKER_DEPLOY=PASS versión actual en ORIGINAL; scripts externos actualizados fuera de Docker por diseño
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5
HEALTHZ=200
READYZ=200
API_LIVE=200
API_READY=200
E2E_DOCKER=PASS catálogo en cinco alumnos y UI real de Alumno Prueba local; integral pendiente
FUNCTIONAL_TEST=PASS diez materiales visibles por alumno, bloqueos propios y descarga autorizada real
SECURITY=PASS alcance reparado; integral BLOCKED y CA estricta FAIL previo
SECRETS_IN_GIT=0 detecciones Gitleaks en árbol distribuible y dos entregables; historial NOT_RUN
COMMIT=NOT_RUN condicionado al cierre integral
PUSH=NOT_RUN condicionado al cierre integral
LOCAL_HEAD=3db68f34e62f382ee60a21ec4e2d035957c70282
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779
CRITICAL=No se declara cero global
HIGH=F16 BLOCKED
ERRORS=[Cobertura integral de controles,Google real,SMTP externo,CA estricta/Firefox,F15 externos,F16 ICE-DTLS,rendimiento integral]
CATALOG_STATUS=VALIDATED_LOCAL
CHANGE_STATUS=COMPLETE reparación local
AUDIT_STATUS=BLOCKED
RELEASE_GATE=BLOCKED
GITHUB=BLOCKED hasta validación integral conforme a autorización condicional
PUBLIC_DEPLOYMENT=NOT_RUN
```

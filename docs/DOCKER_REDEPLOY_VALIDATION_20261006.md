# Validación del despliegue Docker — 2026-10-06

Se ejecutó de nuevo el arranque oficial con reconstrucción sobre la pila
principal `uasspain`, validando la aplicación servida por `https://localhost`.
La configuración vigente y las fuentes ya estaban publicadas y el árbol de
trabajo estaba limpio. Este informe registra una nueva ejecución de los gates;
no introduce cambios de aplicación ni de Compose para generar un commit.

```powershell
powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build
```

El comando terminó con código 0. Compose reutilizó la caché de los inputs sin
cambios y reconcilió los servicios con las imágenes configuradas. La comprobación
posterior verificó los manifiestos de plataforma de las imágenes en ejecución
contra los tags construidos; no se confundieron IDs de configuración con IDs de
manifiestos OCI. No se actualizaron Docker Engine ni el plugin Compose instalados.

| Evidencia | Resultado observado |
| --- | --- |
| Fuentes de la aplicación validadas | `9f3186084c5cf9228fcce7d891beb025ad894460` |
| Docker Engine instalado | `29.8.1` |
| Docker Compose instalado | `5.5.1` |
| Identidad frontend servida y dentro del contenedor | `810430ae-6bfb-45a8-bcd0-c25ee8e0c22a` |
| Verificación de almacenamiento tras reconstruir | `2026-10-06 00:35:12 Europe/Madrid` |
| TLS de los endpoints de salud | CA y hostname verificados |
| Servicios permanentes saludables | `5/5` |

| Servicio | Imagen configurada | Estado |
| --- | --- | --- |
| nginx | `uasspain-nginx:1.30.5-alpine3.24` | HEALTHY |
| frontend | `uasspain-frontend:nginx1.30.5-alpine3.24` | HEALTHY |
| backend | `uasspain-backend:rust1.99.0-ubuntu26.04` | HEALTHY |
| postgres | `uasspain-postgres:18.6-alpine3.24-encrypted` | HEALTHY |
| redis | `uasspain-redis:8.2.10-alpine` | HEALTHY |

Los cuatro endpoints `/healthz`, `/readyz`, `/api/health/live/` y
`/api/health/ready/` respondieron HTTP 200 a través del nginx de la pila principal.
`/version.json` coincidió con el fichero del contenedor frontend. Los cinco
manifiestos desplegados coincidieron con las imágenes construidas.

Se compararon los volúmenes persistentes y la identidad de la clave DPAPI con
la captura tomada inmediatamente antes de esta reconstrucción: ambos quedaron
conservados. La verificación de PostgreSQL confirmó gocryptfs AES-256-GCM,
cifrado de nombres, cobertura de PGDATA/WAL/temporales/logs, ausencia de mounts
persistentes en claro, retirada de la clave temporal, capabilities de PostgreSQL
en cero, volumen crudo ilegible sin clave, rechazo de clave incorrecta y swap
deshabilitado. No se recreó la base ni se regeneraron claves.

Las siguientes comprobaciones se ejecutaron de nuevo:

- Typecheck y lint del frontend: PASS.
- Vitest: 9 ficheros y 46 tests aprobados.
- Home sobre Docker: prerender utilizable, acceso antes de hidratar, reutilización
  del h1, menú móvil y cambio de tema aprobados; errores de consola `[]`.
- Rutas y assets sobre HTTPS: 21 rutas directas y refrescadas, 79 assets,
  redirect canónico, 404 reales y recuperación automática sin bucles aprobados.
- Hero sobre Docker: 22 combinaciones de tema/viewport, dos líneas del titular
  sin clipping ni desbordamiento horizontal, radar decorativo, sector fijo,
  movimiento reducido, cambio de tema, CTA de contacto y scroll a servicios.
- Axe en el hero: 6 estados auditados, cero violaciones detectadas. Se conservaron
  las comprobaciones incompletas en la evidencia; no se presenta como certificación.
- Seguridad de las cinco imágenes y las dependencias: cero vulnerabilidades
  altas/críticas detectadas, incluidas las que carecen de corrección disponible.
- Gitleaks de archivos e historial: cero hallazgos antes de crear este informe.
  El gate del índice y del historial con el commit del informe se ejecuta antes
  de publicar; la salud y la función se vuelven a comprobar después del push.

Evidencia local de esta ejecución: `.run/docker-refresh-20261006/`, con
`docker-rebuild.log`, `docker-before.json`, `docker-validation.json`,
`functional.log`, `validation.json`, `tests.log`, `home-rendering.log`,
`browser-assets.json` y `security/summary.json`. La evidencia de runtime y los
informes completos permanecen fuera de Git. No se incluyen claves, tokens,
cookies, credenciales ni el contenido de `.env` en este informe.

El cambio versionado de esta operación es únicamente este informe. La pila
principal queda disponible con sus cinco servicios y los datos existentes.

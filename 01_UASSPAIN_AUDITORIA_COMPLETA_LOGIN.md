# UASSpain — Auditoría y reparación integral del panel de Login

## 0. MISIÓN

Auditar, ejecutar, probar y reparar TODO el sistema de acceso de UASSpain.

No limitarse al formulario visible.

Cubrir de extremo a extremo:

```text
Frontend
→ Nginx
→ Backend Rust
→ PostgreSQL
→ Redis/sesiones
→ SMTP
→ OTP
→ OAuth/OIDC
→ recuperación contraseña
→ autorización por roles
→ logout
```

La aplicación se levanta mediante Docker.

Ciclo obligatorio:

```text
INSPECCIONAR
→ REPRODUCIR
→ CAUSA RAÍZ
→ REPARAR
→ BUILD
→ DOCKER UP
→ TEST
→ E2E
→ LOGS
→ REPETIR HASTA PASS
```

No declarar PASS sin ejecución real.

## 1. REGLAS

- Trabajar sobre el proyecto real.
- No inventar archivos, rutas, tablas, endpoints ni variables.
- Detectar arquitectura existente.
- Mantener backend Rust existente.
- Mantener diseño actual salvo correcciones necesarias.
- No introducir dependencias innecesarias.
- No imprimir secretos.
- No mostrar hashes completos.
- No intentar descifrar contraseñas.
- No crear usuarios artificiales salvo fixtures temporales estrictamente aislados.
- No modificar los tres usuarios reales salvo necesidad autorizada.
- No borrar datos.
- No crear documentación innecesaria.
- Resolver automáticamente errores reparables.
- No detenerse tras el primer fallo reparable.
- No considerar una funcionalidad válida solo porque compile.
- Verificar siempre frontend + proxy + backend + persistencia + flujo real.

Estados permitidos:

```text
PASS
FAIL
BLOCKED
N/A
```

`NOT_RUN != PASS`.

## 2. BASELINE

Antes de cambiar código:

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs
```

Adaptar comandos al proyecto real.

Ejecutar:

- frontend build;
- lint;
- typecheck;
- tests;
- Rust fmt/check/clippy/test;
- tests E2E existentes.

Registrar solo errores relevantes.

## 3. IDENTIFICAR SISTEMA DE AUTENTICACIÓN REAL

Detectar:

- tabla/modelo de usuarios;
- roles;
- email;
- password hash;
- sesiones;
- JWT si existe;
- Redis;
- cookies;
- refresh tokens;
- OTP/MFA;
- OAuth/OIDC;
- recuperación;
- SMTP;
- endpoints frontend/backend;
- rutas Nginx.

Crear mapa interno:

```text
UI
→ frontend API client
→ URL
→ método HTTP
→ Nginx
→ Rust route
→ handler
→ service
→ DB/Redis/SMTP/OAuth
```

Verificar cada transición.

## 4. LOS 3 USUARIOS REALES

Localizar inequívocamente:

```text
ADMINISTRADOR
INSTRUCTOR
ALUMNO/USUARIO
```

Mostrar al final únicamente:

```text
ID
NOMBRE
EMAIL
ROL
ACTIVO
VERIFICADO
TIPO_AUTH
```

No mostrar contraseñas existentes.

Separar cuentas reales de:

```text
TEST
DEMO
FIXTURE
SEED
TEMP
```

## 5. LOGIN POR EMAIL — CASE INSENSITIVE

Debe funcionar igual:

```text
usuario@dominio.es
Usuario@Dominio.es
USUARIO@DOMINIO.ES
```

Normalización principal en backend/DB:

```text
trim
→ canonicalización
→ comparación case-insensitive
```

Auditar:

- registro;
- login;
- recuperación;
- OTP;
- cambio email;
- admin;
- OAuth linking;
- UNIQUE DB.

Detectar previamente posibles colisiones.

Nunca borrar automáticamente usuarios duplicados.

Aplicar solución DB compatible:

```text
LOWER(email)
CITEXT
índice funcional
```

o equivalente seguro.

## 6. FORMULARIO LOGIN

Auditar:

- email;
- password;
- mostrar/ocultar;
- submit;
- Enter;
- autofill;
- gestor passwords;
- loading;
- disabled;
- mensajes;
- navegación;
- recuperación;
- registro;
- OAuth;
- OTP.

Email:

```html
<input
  type="email"
  autocomplete="username"
  autocapitalize="none"
  spellcheck="false"
/>
```

Password:

```html
<input autocomplete="current-password" />
```

No bloquear copy/paste.

## 7. CASOS LOGIN

Probar:

```text
email vacío
email inválido
email con espacios
email lowercase
email uppercase
email MixedCase
email inexistente
password vacío
password incorrecto
credenciales válidas
doble submit
respuesta lenta
backend caído
DB caída
Redis caído
sesión expirada
cuenta deshabilitada
```

Sin estados inconsistentes.

## 8. RECUPERACIÓN DE CONTRASEÑA — FALLO ACTUAL

Existe actualmente un error visible:

```text
"Recurso no encontrado."
```

Reproducir y localizar causa real.

Revisar:

```text
frontend component
API client
URL
HTTP method
/api prefix
Nginx proxy
Rust route
handler
DB
SMTP
Docker network
```

No ocultar el 404 cambiando solo el texto.

## 9. FLUJO RESET COMPLETO

Debe existir:

```text
email
→ normalización
→ solicitud
→ respuesta neutra
→ token criptográfico
→ expiración
→ envío SMTP
→ enlace HTTPS
→ formulario nueva contraseña
→ validación
→ consumo único token
→ revocación
→ login nueva password
```

Respuesta pública:

```text
Si existe una cuenta asociada a ese correo,
recibirás un enlace para restablecer tu contraseña.
```

Debe ser equivalente exista o no la cuenta.

## 10. SEGURIDAD TOKEN RESET

Validar:

- CSPRNG;
- longitud suficiente;
- expiración;
- single-use;
- hash almacenado si diseño lo permite;
- invalidación al usar;
- invalidación tras cambio de password;
- no logs;
- no exposición en frontend innecesaria;
- HTTPS;
- dominio permitido;
- anti open-redirect;
- rate limit;
- protección replay.

Probar:

```text
token válido
token expirado
token modificado
token usado
token inexistente
token de otro usuario
```

## 11. SMTP

Verificar:

```text
DNS
TCP
TLS/STARTTLS
certificado
hostname/SAN
auth
sender
timeout
retry
```

Si existen credenciales autorizadas:

```text
connect
→ TLS
→ auth
→ envío
→ aceptación SMTP
→ llegada flujo real
```

No declarar `SMTP=PASS` solo porque existan variables.

Si falta credencial externa:

```text
SMTP=BLOCKED
REASON=<exacta>
```

Revisar además si aplica:

- SPF;
- DKIM;
- DMARC;
- envelope-from;
- dominio remitente;
- plantillas;
- rate-limit;
- no header injection.

## 12. OTP / MFA

Si existe:

Auditar:

- generación;
- aleatoriedad;
- expiración;
- single-use;
- retries;
- rate limit;
- bloqueo razonable;
- envío;
- normalización email;
- invalidación;
- replay;
- concurrencia;
- logs.

Probar:

```text
correcto
incorrecto
expirado
reutilizado
múltiples solicitudes
resend
```

No imprimir OTP en producción.

## 13. OAUTH / OIDC

Detectar proveedores reales.

Validar:

```text
issuer
discovery
client_id
client_secret backend-only
redirect URI
scopes
PKCE
state
nonce
JWKS
iss
aud
exp
nbf
refresh
revocation
logout
```

Especial atención a account linking:

```text
usuario@dominio.es
Usuario@Dominio.es
```

no deben crear cuentas duplicadas ni permitir account takeover.

No confiar solo en claim `email`.

Validar `email_verified` cuando corresponda.

## 14. SESIONES / JWT

Determinar sistema real.

Auditar:

- creación;
- renovación;
- expiración;
- revocación;
- logout;
- múltiples pestañas;
- sesión caducada;
- refresh;
- reuse;
- Redis si participa.

Si cookies:

```text
Secure
HttpOnly
SameSite
Path
Expires/Max-Age
```

No guardar tokens sensibles en `localStorage` si la arquitectura soporta opción más segura.

## 15. LOGOUT

Validar:

```text
logout
→ sesión/token invalidado
→ Redis limpiado si aplica
→ cookie eliminada
→ ruta privada inaccesible
→ back browser no recupera sesión
```

Probar logout en los 3 roles.

## 16. AUTORIZACIÓN DE ROLES

Login válido NO implica acceso universal.

Verificar backend:

```text
ADMIN → ADMIN = ALLOW
INSTRUCTOR → INSTRUCTOR = ALLOW
USER → USER = ALLOW

INSTRUCTOR → ADMIN = DENY
USER → ADMIN = DENY
USER → INSTRUCTOR = DENY
```

No confiar únicamente en ocultar enlaces React.

Probar acceso directo por URL y API.

## 17. RATE LIMIT / BRUTE FORCE

Auditar:

- login;
- reset;
- OTP;
- OAuth callbacks cuando aplique.

Evitar:

- brute force;
- credential stuffing básico;
- flooding SMTP;
- flooding OTP.

No bloquear permanentemente usuarios legítimos.

## 18. ANTI ENUMERACIÓN

Mensajes equivalentes para:

```text
usuario inexistente
password incorrecta
reset email inexistente
```

No filtrar:

- ID;
- rol;
- existencia;
- estado;
- backend stack;
- SQL;
- rutas internas.

## 19. CORS / CSRF / HEADERS

Auditar:

```text
CORS
CSRF si aplica
CSP
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
frame-ancestors
HSTS HTTPS
```

No usar:

```text
Access-Control-Allow-Origin: *
```

con credenciales.

## 20. XSS / SQLi / VALIDACIÓN

Probar de forma local/autorizada:

```text
HTML/JS input
SQL metacharacters
payloads largos
Unicode
espacios
NULL-like data
headers anómalos
```

Validación definitiva server-side.

No pruebas destructivas.

## 21. ACCESIBILIDAD

Auditar:

- labels;
- focus;
- teclado;
- Tab;
- Enter;
- Escape;
- aria-invalid;
- aria-describedby;
- aria-live;
- contraste;
- zoom;
- lector pantalla;
- móvil.

## 22. RESPONSIVE LOGIN

Probar:

```text
320
360
375
390
412
480
768
820
1024
1280
1440
1920
```

y poca altura.

No permitir:

- overflow horizontal;
- botones cortados;
- modal fuera de pantalla;
- teclado móvil ocultando submit;
- mensajes inaccesibles.

## 23. TEMA LOGIN

Validar:

```text
dark
light
reload
```

Tema claro:

- suave;
- sin blanco deslumbrante;
- sin efecto niebla;
- sin blur/overlay innecesario;
- contraste AA cuando aplique.

## 24. NGINX / DOCKER

Verificar rutas reales:

```text
/login
/api/auth/*
/password/*
/oauth/*
/otp/*
```

o equivalentes reales.

Confirmar:

```text
frontend → Nginx → backend Rust
```

No deben existir:

- 404 por proxy incorrecto;
- prefijo duplicado;
- rutas inconsistentes;
- puertos internos públicos innecesarios.

## 25. TESTS E2E

Crear/ampliar tests existentes.

Mínimos:

```text
LOGIN_LOWERCASE
LOGIN_UPPERCASE
LOGIN_MIXEDCASE
LOGIN_BAD_PASSWORD
LOGIN_UNKNOWN_USER

ADMIN_LOGIN
INSTRUCTOR_LOGIN
USER_LOGIN

PASSWORD_RESET_REQUEST
PASSWORD_RESET_UNKNOWN_EMAIL
PASSWORD_RESET_TOKEN_VALID
PASSWORD_RESET_TOKEN_EXPIRED
PASSWORD_RESET_TOKEN_REPLAY
PASSWORD_RESET_NEW_LOGIN

OTP_VALID
OTP_INVALID
OTP_EXPIRED
OTP_REPLAY

OAUTH_LOGIN
OAUTH_STATE_INVALID
OAUTH_LINK_EXISTING_EMAIL

SESSION_EXPIRY
REFRESH
LOGOUT
ROLE_ISOLATION
```

Aplicar solo los que correspondan a funcionalidades existentes.

## 26. LOGS

Tras pruebas:

```bash
docker compose logs
```

No aceptar:

```text
panic
500 inesperado
404 funcional
SQL error
Redis error
SMTP loop
OAuth loop
WS reconnect loop
secret leakage
```

## 27. GATES

```text
LOGIN_PANEL=PASS
LOGIN_API=PASS
LOGIN_CASE_INSENSITIVE=PASS
LOGIN_DB_NORMALIZATION=PASS
LOGIN_RATE_LIMIT=PASS
LOGIN_ANTI_ENUMERATION=PASS
LOGIN_RESPONSIVE=PASS
LOGIN_ACCESSIBILITY=PASS

PASSWORD_RECOVERY_UI=PASS
PASSWORD_RECOVERY_API=PASS
PASSWORD_RECOVERY_NGINX=PASS
PASSWORD_RESET_TOKEN=PASS
PASSWORD_RESET_EXPIRY=PASS
PASSWORD_RESET_SINGLE_USE=PASS
PASSWORD_RESET_E2E=PASS

SMTP_CONFIG=PASS|BLOCKED
SMTP_TLS=PASS|BLOCKED
SMTP_AUTH=PASS|BLOCKED
SMTP_SEND=PASS|BLOCKED

OTP=PASS|N/A
OTP_SECURITY=PASS|N/A
OTP_E2E=PASS|BLOCKED|N/A

OAUTH_CONFIG=PASS|N/A
OAUTH_SECURITY=PASS|N/A
OAUTH_LINKING=PASS|N/A
OAUTH_E2E=PASS|BLOCKED|N/A

SESSION_SECURITY=PASS
LOGOUT=PASS
ROLE_ISOLATION=PASS

ADMIN_LOGIN=PASS
INSTRUCTOR_LOGIN=PASS
USER_LOGIN=PASS

CONSOLE_ERRORS=0
UNEXPECTED_4XX=0
UNEXPECTED_5XX=0
CRITICAL=0
HIGH=0
```

## 28. SALIDA FINAL

Responder solo:

```text
LOGIN_AUDIT=PASS|FAIL|BLOCKED

REAL_USERS_FOUND=3/3

ADMIN_EMAIL=<email>
INSTRUCTOR_EMAIL=<email>
USER_EMAIL=<email>

LOGIN=PASS|FAIL
EMAIL_CASE_INSENSITIVE=PASS|FAIL
PASSWORD_RECOVERY=PASS|FAIL
SMTP=PASS|BLOCKED|FAIL
OTP=PASS|N/A|BLOCKED
OAUTH=PASS|N/A|BLOCKED
SESSION_SECURITY=PASS|FAIL
LOGOUT=PASS|FAIL
ROLE_ISOLATION=PASS|FAIL
RESPONSIVE=PASS|FAIL
ACCESSIBILITY=PASS|FAIL

E2E=<pass>/<total>
CRITICAL=<n>
HIGH=<n>

FIXED:
- ...

BLOCKERS:
- NONE | ...
```

No terminar mientras quede un fallo reparable.

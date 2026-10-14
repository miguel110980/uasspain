# Google OAuth 2.0 — implementación y aceptación aislada

Informe histórico del 13/10. La autorización documental del 14/10 permite
actualizar Docker local y publicar tras superar los gates. El estado posterior
se registra en [validación local](../LOCAL_VALIDATION.md); los bloqueos de permiso
descritos aquí corresponden a la ejecución original. La aceptación con Google
real sigue siendo independiente de la prueba con proveedor sintético.

## Estado y permisos

Código implementado y probado en Docker aislado. **No desplegado en MAIN; CHANGE_STATUS=NOT_COMPLETE.** La petición actual prohíbe commit, push y despliegue sin autorización posterior. No se ha realizado ninguna de esas operaciones. La vinculación/verificación real con Google requiere el cliente web autorizado, el secreto guardado por el administrador y su interacción con Google; las pruebas sintéticas no sustituyen esa aceptación.

## INSPECT → AUDIT → PLAN

Se leyeron AGENTS.md y docs/REPAIR_WORKFLOW.md. La integración anterior sólo persistía enabled/Client ID, generaba un challenge en la comprobación administrativa y permitía seleccionar una cuenta sin vínculo por coincidencia de email. MAIN tenía un Client ID configurado y cero vínculos Google; se consultó únicamente la presencia de configuración, sin mostrar credenciales.

Se reutilizan `core_systemsetting`, `core_systemsecret`, FieldCipher AES-256-GCM, el índice único existente `accounts_userprofile.google_subject_lookup`, autorización por sesión/ventana, verificación de contraseña, política OTP, revocación de sesiones y auditoría administrativa. No se reconstruye el sistema de usuarios ni se crea un proveedor de correo paralelo.

## IMPLEMENT → INTEGRATE

- Configuración administrativa de correo corporativo Google, Client ID y secreto cifrado. Campo vacío conserva el secreto. Revisión evita sobrescrituras concurrentes; cambios relevantes invalidan la prueba anterior.
- Origen generado exclusivamente desde FRONTEND_URL válido, sin Host/X-Forwarded-Host, credenciales, query o fragmentos. Callback exacto `/auth/google/callback`, direcciones copiables e instrucciones en el panel y [guía operativa](../google-oauth-operations.md).
- Authorization Code con PKCE S256, state/cookie/ventana vinculados, nonce y expiración de cinco minutos. Consumo atómico persistente antes del intercambio; replay denegado tras reinicio. Firma RS256/JWKS, issuer, audience/azp, expiración/iat/nbf, email_verified y sub válido.
- Vinculación sólo del administrador autenticado y reautenticado, sin elección de usuario por email ni asignación de roles. Subject único; conflictos conservan las identidades anteriores. Login sólo de cuentas previamente vinculadas, con estado y permisos PostgreSQL y la política OTP existente.
- Desvinculación con contraseña vigente y texto DESVINCULAR; revoca sesiones propias y conserva acceso convencional. El login comprueba nuevamente el vínculo bajo bloqueo del perfil para impedir una carrera con desvinculación.
- Callback retira el código de la URL antes de montar la aplicación y restaura únicamente su handoff de ventana. Código no persistido en sessionStorage; verifier, tokens y secreto permanecen en backend. Nginx no registra query/callback, y sirve no-store/no-referrer/noindex.
- Migración expand 0030: flujo efímero cifrado y evidencia de seguridad. El runtime no puede UPDATE/DELETE la evidencia. Aplicada exclusivamente a PostgreSQL E2E, sin editar migraciones anteriores ni cambiar vínculos reales.
- La configuración Google no altera SMTP, Postmark, destinatario corporativo ni secretos de correo. No se otorgan permisos por email, dominio o claims de roles de Google. El flujo legado con ID token queda rechazado después de configurar el flujo seguro; login convencional disponible.

## TEST → REPAIR → REGRESSION

Evidencias privadas fuera de Git: `.run/google-oauth-20261013/`.

| Gate | Resultado observado |
|---|---|
| Rust fmt/check/clippy/tests | PASS, 143 tests sobre la fuente final |
| Frontend typecheck/lint/tests | PASS, 76 tests en 16 archivos |
| Builds backend/frontend producción | PASS, tags propios de E2E; MAIN intacto |
| Regresión completa API | PASS, 137/137 base y suites complementarias de auth/OTP/permisos/backups/sesiones/chat/vídeo/dependencias |
| OAuth integrado | PASS, 61 comprobaciones con proveedor sintético y firma RSA real de prueba |
| Navegador HTTPS | PASS, 9 escenarios; 8 capturas, temas claro/oscuro y 320/390/768/1440 |
| Regresión posterior a limpieza | PASS, 40 comprobaciones de sesiones/permisos/WSS; perfiles propios sin residuos |
| Secretos fuente/historial e imágenes | Cero hallazgos en los escaneos ejecutados |
| Vulnerabilidades HIGH/CRITICAL | Cero en fuente, imágenes principales e imágenes candidatas |
| `git diff --check`, índice | PASS; sin stage, commit ni push |
| Google real | BLOCKED_EXTERNAL, no probado ni declarado PASS |
| Docker principal actualizado | BLOCKED_PERMISSION, no se ha desplegado |

Las pruebas específicas incluyen permisos ADMIN/INSTRUCTOR/ALUMNO, secreto preservado/cifrado/no devuelto, activación prematura, reautenticación, identidad con email coincidente ajeno, sub ocupado, email coincidente sin vínculo, issuer/audience/azp/nonce/exp/email_verified/sub inválidos, replay/concurrencia, otra ventana, expiración, persistencia tras reinicio, unlink y acceso convencional. Un alumno con identidad previamente vinculada no obtiene ADMIN aunque el token sintético incluya ese rol y un email de administrador.

La primera regresión encontró tres expectativas antiguas que permitían activar con sólo un Client ID; se sustituyeron por los gates de verificación exigidos. Los primeros mocks de navegador incumplían contratos de listas públicas y contaban el refresh inicial ajeno a OAuth. Se corrigieron los fixtures y se volvió a ejecutar toda esa suite, sin modificar producto para ocultar fallos ni reducir pruebas.

El proveedor `google-oidc-e2e` es temporal, sin persistencia de claves privadas y exclusivamente en la red de pruebas. El adaptador rechaza MAIN, producción y bases/hosts ajenos. No se presenta su firma sintética como evidencia de autenticación Google. Se registraron IDs exactos; se eliminaron sólo los perfiles, flujos y correos/archivos demostrablemente propios. La evidencia protegida sintética se conserva expresamente, por lo que no se declara cero residuos globales.

## Versiones y cierre pendiente

`runtime-proof.json` registra las imágenes y hashes. MAIN conserva esquema 29 y binario `d3ddccfd422d70323dbcd772f400833e6aa3f5e09bcdfc090701a247953e2638`. E2E tiene esquema 30 y binario OAuth `ef186fe65e2ed190738f23f8e5ef46e74d0adca9568462928bcafe2a89f014b3`. No son la misma versión; la aceptación aislada no acredita actualización de MAIN.

Para cerrar Docker principal se necesita autorización para backup cifrado/restauración aislada, migración compatible, arranque oficial con -Build, cinco servicios saludables, cuatro HTTP 200 y pruebas con las imágenes finales sobre datos aislados. No se necesitan perfiles de prueba en MAIN. Google permanecerá efectivamente desactivado hasta verificar las nuevas credenciales/origen; las asociaciones existentes se conservan.

No se solicitarán secretos por chat. La aceptación real posterior debe ejecutarla un administrador con acceso autorizado a Google Cloud y a su cuenta Google desde la interfaz preparada. No hay autorización para commit/push. `scripts/start-watch-hidden.vbs` permanece fuera de la tarea.

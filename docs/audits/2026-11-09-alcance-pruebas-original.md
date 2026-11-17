# Pruebas funcionales propuestas en el ORIGINAL

Estado vigente: autorización específica recibida y ensayos delimitados ejecutados.
Los cuatro perfiles nuevos están bloqueados y los recursos nuevos inactivos;
sus datos se conservan sin borrados. Ver el manifiesto y la desactivación final
en .run/original-20261109-evidence/ y el dictamen actual en
[verificacion-anterior.md](2026-11-09-verificacion-anterior.md).
El resto del documento conserva el alcance autorizado y sus exclusiones.
Se reutilizan casos y documentos sintéticos anteriores, no su implementación de
la aplicación, entorno, base, claves ni PASS. No se crea ninguna instalación.

## Actores y límites

- Las dos cuentas instructor y cinco alumno del almacén DPAPI existente están
  contrastadas con siete perfiles sintéticos @example.invalid. Sus contraseñas
  no se muestran ni se copian al informe. Se usarían las cuentas instructor como
  actores y la cuenta sintética con sesión admin para crear los ensayos.
- Crear como máximo un instructor adicional y tres alumnos nuevos, inequívocamente
  etiquetados UAS-AUDIT-20261109-<identificador>, con correos @example.invalid.
- Guardar IDs de todas las entidades nuevas en un manifiesto antes de operarlas;
  credenciales/tokens solo en memoria o almacén DPAPI local excluido de Git.
- Asignar y reasignar únicamente alumnos creados por esta ejecución A→B→C.
  No cambiar roles, asignaciones, contraseñas, historial ni datos de cuentas previas.

## Acciones delimitadas

Crear recursos y bancos sintéticos A1/A3 y A2, preguntas y cuatro opciones, material
de prueba, concesiones explícitas, intentos/resultados, prácticas, mensajes y
metadatos de llamadas únicamente para esos alumnos. Reutilizar los documentos
PDF/DOCX/DOC sintéticos anteriores para probar vista previa, confirmación y
persistencia de borradores. Ensayar decisiones 29/40,30/40,22/30,23/30, duración,
revisiones concurrentes, vencimiento y reintento en intentos nuevos. Adelantar el
plazo o bloquear una fila solo de un intento nuevo, identificado, si el caso lo exige.

Probar bandeja y resoluciones concurrentes sobre solicitudes nuevas con estado
sintético preparado; esto NO sustituye una validación real de OTP/SMTP. Comprobar
historial, revocación, privacidad de chat, autorización de vídeos y registros de
acceso con los mismos IDs/contratos de los ensayos previos, adaptando solo origen,
actores y preparación del fixture a la instalación original.

Los intentos de borrado denegados usarían únicamente IDs nuevos de esta ejecución;
no ejecutar borrados efectivos ni pruebas destructivas. Al terminar, desactivar
solo las cuentas y recursos nuevos de ensayo, conservar sus datos etiquetados y
registrar los IDs. No borrar ficheros, usuarios, datos o backups anteriores.

## Casos que siguen bloqueados

No cambiar política SMTP, activar DEV_EMAIL, simular OAuth real, vincular Google,
rotar claves, crear réplicas, reiniciar por rutina, hacer restauraciones ni enviar
mensajes a destinatarios reales. OTP/SMTP real requiere destino/control de correo
específico. Cuotas globales, carga disruptiva, dos redes físicas, VPN/SFTP externo,
restauración y eliminación efectiva siguen BLOCKED con el permiso actual.

## Verificación de preservación

Comparar IDs, conteos y huellas de los registros académicos previos; los cambios
esperados de la ejecución deben referenciar exclusivamente los IDs del manifiesto.
Cerrar solo las sesiones creadas para las pruebas. Publicar resultados por caso
PASS/FAIL/BLOCKED, con versión Docker y evidencias, sin trasladar PASS históricos.

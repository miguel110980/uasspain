# Excepciones temporales de advisories Rust

## RUSTSEC-2023-0071 (`rsa` 0.9.10)

- Estado: aceptada temporalmente; no es una dependencia compilada.
- Responsable: UASSpain Security.
- Revisión obligatoria: 2026-10-15.
- Evidencia: `cargo tree -i rsa --locked` no encuentra una ruta activa. La entrada
  permanece en `Cargo.lock` como metadato opcional de `sqlx-mysql`; el servicio
  activa exclusivamente `sqlx/postgres`.
- Intento de eliminación: retirar `sqlx/macros` no es compatible porque el código
  usa `#[derive(sqlx::FromRow)]` y provoca errores de compilación.
- Condición de cierre: eliminar la excepción cuando SQLx deje de introducir esa
  entrada inactiva o cuando exista una actualización compatible de `rsa`.
- Límite: si `cargo tree -i rsa` devuelve una ruta activa, esta excepción deja de
  ser válida y el gate debe fallar.

# Tarjetas y páginas públicas de cursos

Cada registro de `courses` genera una tarjeta en `/formacion`, con «Ver curso» y
una página en `/formacion/{slug}`. El editor administrativo, la API pública y la
plantilla `CourseTemplate` comparten esos mismos datos. No hay que añadir rutas,
componentes ni cursos al código al crear uno desde el panel.

- **Publicado:** página con descripción, modalidad, duración y temario ordenado;
  incluida en el sitemap de cursos.
- **Próximamente:** tarjeta con enlace y página con resumen, modalidad, duración
  y aviso de próxima publicación. La API oculta descripción completa,
  introducción, temario y secciones; el HTML inicial y React aplican `noindex`.
  El resumen público puede contener los primeros 320 caracteres de la descripción,
  conforme al comportamiento existente del editor.
- Cambiar el nombre, categoría o estado conserva la URL generada al crear el curso.
  Editar o publicar actualiza las consultas del catálogo y la página; volver a la
  pestaña también refresca los datos.
- El menú Formación sigue agrupando por categoría y señalando los cursos próximos;
  las tarjetas permiten abrir su página antes de publicarlos.
- Eliminar un curso retira su tarjeta, página y temas asociados. Una URL eliminada
  o inexistente devuelve 404.

La migración aditiva `0014_course_public_routes.sql` añade
`courses_public_slug_check`, con el mismo formato de ruta que valida Rust. Mantiene
las rutas simples y los prefijos existentes `easa/`, `no-easa/` e `instructor/`,
además de la restricción UNIQUE sobre `slug` y la relación de temas con borrado
en cascada. No modifica cursos, estados ni datos personales; se conservan el
volumen cifrado, las claves y las sesiones existentes.

## Comprobación reproducible

El test `frontend/e2e/courses.spec.ts` recorre creación, página próxima,
publicación, edición con URL estable, retirada de publicación y eliminación con
PostgreSQL y backend reales en la pila E2E aislada. También comprueba los endpoints
de HTML y sitemap, incluida la ocultación del contenido pendiente.

`frontend/e2e/course-catalog.spec.ts` comprueba tarjetas y páginas de ambos estados
en 320, 390, 768 y 1440 píxeles, recarga y actualización al volver a la pestaña.

Tras aplicar las migraciones, ejecutar `scripts/e2e/verify-course-routes.sql` con
`psql -v ON_ERROR_STOP=1`: prueba rutas válidas, rechaza rutas inválidas y duplicadas
y revierte todos los registros de prueba. Para el HTML Docker, ejecutar
`scripts/e2e/verify-public-site.mjs` con `SITE_TEST_URL=https://localhost` y,
opcionalmente, `SSR_TEST_UNPUBLISHED_SLUG` con un curso próximo de ruta simple.

## Validación del cambio

- Rust: formato, compilación, Clippy sin advertencias y 76 pruebas correctas.
- Frontend: comprobación de tipos, lint, 8 pruebas unitarias y 7 pruebas de navegador.
- Docker local: las 15 tarjetas enlazan a su página y admiten recarga; comprobados
  ambos estados, HTML inicial, sitemap y HTTPS con verificación de la CA.
- PostgreSQL: 14 migraciones con checksum correcto; restricciones de rutas válidas,
  inválidas y duplicadas comprobadas. Las huellas del contenido, temas y sesiones
  coinciden con las anteriores a la actualización: 15 cursos y 5 cuentas conservados.
- Cifrado en reposo mediante gocryptfs y conexiones del backend con TLS 1.3;
  los cinco servicios siguen saludables tras actualizar backend, frontend y Nginx.

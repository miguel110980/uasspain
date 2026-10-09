# Auditoría y reparación responsive — 2026-10-09

Fase 02, después de publicar y validar arranque/login (`945722a`) y backups
(`394b753`). Se utilizó la habilidad Product Design audit para capturar y revisar
la interfaz antes de modificarla. Las verificaciones funcionales utilizan el
navegador E2E autorizado por el procedimiento del repositorio.

## Causas y alcance

- La foto dependía de la anchura acotada del canvas del HUD. En 2560×1080
  ocupaba 1919,22 px y dejaba unos 320 px de fondo oscuro a cada lado. En móvil
  horizontal también aparecía espacio sin foto; la máscara superior y el
  sombreado lateral reforzaban las bandas.
- La foto, el dron y el HUD conservan sus dimensiones y posiciones originales.
  Los wrappers externos extienden los bordes de esa misma foto. Sólo utilizan
  paisaje de sus 300 píxeles laterales y cielo de sus primeros 100 píxeles:
  no repiten el dron al crecer el viewport. Las pruebas 4K detectaron y
  corrigieron esa repetición en una primera versión de las extensiones.
- Navbar añadía un borde inferior y una sombra con el scroll. Se retiraron esos
  divisores y el borde superior del menú móvil; permanecen el fondo y el blur.
- Contacto, Tecnología de Home y Footer incluían divisores horizontales cian
  independientes del menú. Se eliminaron desde los componentes compartidos.
- El supuesto cambio de anchura del header no se reprodujo: el nav ocupaba el
  viewport completo antes y después del scroll. Su contenido mantiene el
  max-width existente de 1600 px. Se valida el primer render sin JavaScript,
  la hidratación, el resize y el reload; no se cambió el diseño del header.

No se alteraron las constantes ni el SVG del radar, su barrido, tipografía,
colores, textos, botones o composición. Se cotejó su código con `394b753`.
El modo de movimiento reducido y la reanudación del barrido se probaron.

## Capturas y revisión

Evidencia local: `.run/order-20261009/02/before/`, `after/` y `public/`.

1. Home ancha: bandas laterales reproducidas; foto ampliada mediante sus bordes
   externos después de la reparación. Radar y contenido central conservados.
2. Home desktop: jerarquía, dron, ejes y botones preservados.
3. Home móvil vertical: controles y distintivos visibles, sin overflow lateral.
4. Home móvil horizontal: foto también en laterales y zona superior.
5. Contacto: formulario estable; divisor cian superior eliminado. Esta fase no
   acredita entrega de correo, que corresponde al Markdown 05.
6. Servicios, Tecnología y Footer: layout y tarjetas conservados; divisores
   decorativos retirados en el componente que los generaba.
7. Nosotros y Blog en móvil/desktop y ambos temas: texto legible y reflow sin
   desplazamiento horizontal; Blog mostraba su estado vacío real.
8. Pantalla 4K: un único dron y el HUD original centrado; extensión sólo de
   cielo y paisaje fuera del canvas original.

Las capturas se inspeccionaron; las primeras de Contacto aún animándose se
descartaron y se repitieron esperando el estado estable. Las capturas no
demuestran conformidad WCAG completa: los ocho controles axe de la Hero
complementan la revisión visual dentro de ese alcance.

## Validación

- Frontend definitivo: typecheck, lint y 46 tests superados. Build y despliegue
  mediante `scripts/start-encrypted-stack.ps1 -Build`; cinco servicios saludables.
- HTTP 200 con la CA validada en healthz, readyz, API live y API ready. Se
  cotejaron imágenes y `version.json`, preservando clave DPAPI y volúmenes.
- Hero sobre Docker: 16 estados/80 fases de barrido y 56 estados responsive,
  ocho checks axe y navegación de ambos CTA superados.
- La matriz pública incluye los cursos reales recibidos de la API. Comprueba
  scroll, resize, primer render sin JavaScript y reload, sin interceptar la API.
  Su runner reproducible es `scripts/e2e/e2e-public-responsive.mjs`.
- El despliegue final tiene build ID `ebaddad4-1f0f-42dc-a848-6082f6db58e9`.

La revisión del ciclo de rebuild detectó un error DNS transitorio de Nginx
durante la sustitución de frontend (17:55:43, hora local). Recuperó la salud;
se revisan por separado los logs posteriores al despliegue estable. No se
presenta ese error histórico como cero errores de todo el ciclo.

- La matriz final sobre la instancia principal superó 600 estados: 30 rutas,
  diez tamaños y dos temas. No hubo errores, overflow, bandas sin foto ni
  divisores cian. Chrome registró diez avisos de preload del logo durante resize;
  son avisos observados, no errores de funcionamiento.
- Después de reiniciar el frontend se mantuvo la misma imagen y build ID.
  Otros 120 estados, incluidos 320×568 y 3840×2160, comprobaron de nuevo
  header, scroll, reload, cobertura fotográfica y rutas reales.
- La regresión completa aislada superó API, concurrencia, backups/deltas,
  124 casos browser y 876 estados de UI, sin errores ni avisos en esa UI.
  Complementa la instancia principal: parte de la ejecución precedió al último
  ajuste de las extensiones superiores de cielo. La matriz de 600 estados y
  las pruebas Hero sobre la imagen definitiva validan ese ajuste.
- Los cinco servicios y los cuatro endpoints permanecieron saludables tras
  el reinicio. Se retiraron únicamente los seis contenedores y diez volúmenes
  del GUID E2E propio; se conservaron datos, claves y recursos anteriores.

El informe local de cierre registra SHA, push y comprobaciones posteriores a
la publicación, junto con el alcance temporal de los logs y los resultados
de seguridad. La publicación se realiza sólo después de los gates anteriores.

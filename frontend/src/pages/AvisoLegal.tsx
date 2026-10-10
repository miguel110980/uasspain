import React from 'react';
import LegalLayout from '@/components/layout/LegalLayout';
import { corporateContactEmail } from '@/lib/contactConfig';

export default function AvisoLegal() {
  return (
    <LegalLayout title="Aviso Legal" subtitle="Legal">
      <h2 className="font-heading text-lg font-semibold text-foreground">1. Identificación</h2>
      <p>
        Titular: UASSPAIN. Domicilio: Patio de Empresas, Calle Cipriano Alhambra 18, 23440 Baeza, Jaén, España.
        Contacto: +34 607 95 17 41 · {corporateContactEmail}.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">2. Objeto</h2>
      <p>
        Este aviso legal regula el acceso y uso del sitio web uas-spain.com, que UASSPAIN pone a disposición de los usuarios
        con fines informativos y de gestión de servicios relacionados con operaciones profesionales con drones.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">3. Condiciones de uso</h2>
      <p>
        El acceso a este sitio es gratuito. El usuario se compromete a utilizar el sitio y sus contenidos de forma lícita,
        respetando los derechos de propiedad intelectual e industrial, y a no realizar actividades que puedan dañar los sistemas,
        impedir su correcto funcionamiento o vulnerar la normativa vigente.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">4. Propiedad intelectual</h2>
      <p>
        Todos los contenidos (textos, imágenes, logotipos, diseños y código) son titularidad de UASSPAIN o de terceros que han
        autorizado su uso, y están protegidos por la legislación de propiedad intelectual. Queda prohibida su reproducción total
        o parcial sin autorización expresa.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">5. Responsabilidad</h2>
      <p>
        UASSPAIN no garantiza la inexistencia de errores en el acceso al sitio ni la disponibilidad continua del servicio.
        No se responsabiliza de los daños derivados del uso de la web ni de los contenidos de sitios de terceros a los que se
        pudiera acceder mediante enlaces.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">6. Protección de datos</h2>
      <p>
        El tratamiento de datos personales se realiza conforme a nuestra Política de Privacidad, accesible desde el pie de página
        de este sitio.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">7. Legislación aplicable</h2>
      <p>
        Este aviso legal se rige por la legislación española. Para la resolución de cualquier conflicto, las partes se someten
        a los juzgados y tribunales de Baeza (Jaén), salvo aplicación de la normativa de consumo.
      </p>
    </LegalLayout>
  );
}

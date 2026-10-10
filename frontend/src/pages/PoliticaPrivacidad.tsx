import React from 'react';
import LegalLayout from '@/components/layout/LegalLayout';
import { corporateContactEmail } from '@/lib/contactConfig';

export default function PoliticaPrivacidad() {
  return (
    <LegalLayout title="Política de Privacidad" subtitle="Privacidad">
      <h2 className="font-heading text-lg font-semibold text-foreground">1. Responsable del tratamiento</h2>
      <p>
        UASSPAIN, con domicilio en Patio de Empresas, Calle Cipriano Alhambra 18, 23440 Baeza, Jaén, España, contacto: +34 607 95 17 41 · {corporateContactEmail},
        es responsable del tratamiento de los datos personales recogidos a través de este sitio web.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">2. Datos recogidos</h2>
      <p>
        Recogemos los datos que nos facilitas directamente a través del formulario de contacto (nombre, empresa, email, teléfono y mensaje),
        así como los datos necesarios para la gestión de tu cuenta de usuario y sesión (credenciales de acceso y datos de perfil).
        No recopilamos datos a través de cookies de terceros ni con fines publicitarios.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">3. Finalidades</h2>
      <p>Tratamos tus datos con las siguientes finalidades:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Gestionar y responder tus solicitudes de información o contacto.</li>
        <li>Gestionar la autenticación y el acceso de usuarios al panel privado.</li>
        <li>Mantener la sesión activa y la seguridad de la plataforma.</li>
        <li>Cumplir con las obligaciones legales aplicables.</li>
      </ul>

      <h2 className="font-heading text-lg font-semibold text-foreground">4. Legitimación</h2>
      <p>
        La base legal es tu consentimiento al enviar el formulario o registrarte, así como la ejecución de la relación contractual
        y/o precontractual, y el cumplimiento de obligaciones legales.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">5. Conservación</h2>
      <p>
        Los datos se conservarán durante el tiempo necesario para cumplir con las finalidades indicadas y, posteriormente,
        durante los plazos legalmente exigibles. Las cuentas y sesiones inactivas podrán ser eliminadas transcurrido un plazo razonable.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">6. Destinatarios</h2>
      <p>
        No cedemos tus datos a terceros con fines comerciales. Únicamente podrán acceder los proveedores de servicios de hosting y
        infraestructura que actúan como encargados del tratamiento bajo los correspondientes contratos de confidencialidad.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">7. Derechos</h2>
      <p>
        Puedes ejercer tus derechos de acceso, rectificación, supresión, limitación, oposición y portabilidad escribiendo a
        {corporateContactEmail}. Asimismo, tienes derecho a presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD).
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">8. Seguridad</h2>
      <p>
        Aplicamos medidas técnicas y organizativas apropiadas para garantizar la seguridad de los datos y protegerlos frente a
        acceso no autorizado, alteración o divulgación.
      </p>
    </LegalLayout>
  );
}

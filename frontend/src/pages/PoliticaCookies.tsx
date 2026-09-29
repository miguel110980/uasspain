import React from 'react';
import LegalLayout from '@/components/layout/LegalLayout';

export default function PoliticaCookies() {
  return (
    <LegalLayout title="Política de Cookies" subtitle="Cookies">
      <h2 className="font-heading text-lg font-semibold text-foreground">1. Qué son las cookies</h2>
      <p>
        Las cookies son pequeños archivos de texto que el sitio web almacena en tu navegador para reconocerte durante tu visita
        y mantener información sobre tu sesión.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">2. Cookies utilizadas</h2>
      <p>
        En este sitio web utilizamos <strong>exclusivamente cookies técnicas y de sesión</strong>, necesarias para el
        funcionamiento de la plataforma: mantener la autenticación de usuarios, recordar tu sesión mientras navegas por el panel
        privado y garantizar la seguridad del acceso.
      </p>
      <p><strong>No utilizamos cookies de terceros</strong>, ni cookies publicitarias, de analítica externa ni de seguimiento.</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Cookie de sesión / autenticación:</strong> identifica al usuario autenticado mientras dura la sesión. Se elimina al cerrar sesión o al terminar la navegación.</li>
        <li><strong>Cookie técnica esencial:</strong> permite el correcto funcionamiento de la interfaz y la seguridad del acceso.</li>
      </ul>

      <h2 className="font-heading text-lg font-semibold text-foreground">3. Carácter necesario</h2>
      <p>
        Al tratarse de cookies estrictamente necesarias para el funcionamiento y la seguridad del servicio, no requieren
        consentimiento previo conforme a la normativa vigente. Estas cookies no pueden desactivarse, ya que sin ellas la
        autenticación y el acceso al panel no funcionarían.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">4. Gestión y eliminación</h2>
      <p>
        Puedes eliminar las cookies en cualquier momento cerrando tu sesión desde el panel o desde las opciones de configuración
        de tu navegador. Ten en cuenta que, al hacerlo, deberás volver a autenticarte para acceder a las áreas privadas.
      </p>

      <h2 className="font-heading text-lg font-semibold text-foreground">5. Actualizaciones</h2>
      <p>
        Esta política podrá actualizarse si se modifican los servicios prestados. En todo caso, mantendremos el compromiso de no
        incorporar cookies de terceros ni con fines distintos a los descritos.
      </p>
    </LegalLayout>
  );
}
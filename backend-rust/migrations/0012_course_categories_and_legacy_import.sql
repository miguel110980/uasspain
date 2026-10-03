-- Additive migration: the existing editor, courses and topic relationships remain authoritative.
ALTER TABLE courses
    ADD COLUMN category VARCHAR(16) NOT NULL DEFAULT 'other'
        CHECK (category IN ('easa', 'non_easa', 'instructor', 'other')),
    ADD COLUMN presentation JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(presentation) = 'object');

CREATE INDEX courses_category_order_idx ON courses (category, sort_order, name);

-- Preserve the fourteen existing public URLs, copy and menu order. Slash slugs
-- are restricted to the three established route prefixes by the application.
-- Existing rows are never overwritten; sections are only inserted for new rows.
WITH legacy AS (
    SELECT value AS data FROM jsonb_array_elements($legacy_courses$
[
  {
    "name": "A1/A3",
    "slug": "easa/a1-a3",
    "category": "easa",
    "short_description": "Curso de formación online según el temario oficial de AESA para operar drones en categoría abierta con UAS de hasta 25 kg. Válido en toda la Unión Europea.",
    "description": "El curso de formación online A1/A3 prepara a los pilotos para operar en la categoría abierta del Reglamento de Ejecución (UE) 2019/947. Al completarlo y superar el examen online, se obtiene la \"Prueba de superación de formación en línea\".\n\nLa subcategoría A1 permite el vuelo sobre personas no participantes (excepto con UAS clase C1), mientras que la subcategoría A3 requiere volar a 150 m de zonas residenciales, comerciales, industriales y recreativas.\n\nEl curso cubre el marco normativo europeo y español (incluido el Real Decreto 517/2024), principios de vuelo, conocimiento del UAS, espacio aéreo, factores humanos, privacidad, seguridad y procedimientos operacionales.\n\nEs requisito previo para obtener la certificación A2 y para operar en categoría específica bajo escenarios estándar (STS).",
    "duration": "40 horas",
    "modality": "online",
    "sort_order": 1,
    "sections": [
      {
        "title": "Estar familiarizado con las instrucciones del fabricante del UAS",
        "body": ""
      },
      {
        "title": "Completar el curso de formación online A1/A3",
        "body": ""
      },
      {
        "title": "Superar el examen online para obtener la \"Prueba de superación de formación en línea\"",
        "body": ""
      },
      {
        "title": "UAS de clase C0: sin límite de edad (juguete) o 12 años (no juguete)",
        "body": ""
      },
      {
        "title": "UAS de clase C1: 14 años mínimo",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "A1/A3",
      "original_summary": "Curso de formación online según el temario oficial de AESA para operar drones en categoría abierta con UAS de hasta 25 kg. Válido en toda la Unión Europea.",
      "original_modality": "online",
      "icon": "GraduationCap",
      "hero_parts": [
        {
          "text": "Piloto UAS",
          "highlight": false
        },
        {
          "text": "A1/A3",
          "highlight": true
        }
      ],
      "badge": "Categoría Abierta — Subcategorías A1 y A3",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "100% Online",
      "certification": "EASA A1/A3",
      "description_heading": "Sobre el curso",
      "topics_heading": "Requisitos del piloto",
      "cta": {
        "heading": "¿Quieres certificarte en A1/A3?",
        "description": "Formación 100% online según el temario oficial de AESA. Contacta con nosotros para información sobre próximas convocatorias y precios.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación A1 A3 | UASSPAIN",
        "description": "Información del programa de formación A1 A3 de UASSPAIN."
      }
    }
  },
  {
    "name": "A2",
    "slug": "easa/a2",
    "category": "easa",
    "short_description": "Certificación EASA para operar drones con UAS de clase C2 cercanos a personas no participantes. Formación 100% online según el temario oficial de AESA.",
    "description": "La subcategoría A2 permite el vuelo a una distancia horizontal segura de al menos 30 m de personas no participantes, que podrá reducirse hasta un mínimo de 5 m cuando se active la función de modo de baja velocidad.\n\nLa altura se reducirá en la misma proporción que se reduzca la distancia horizontal segura (regla 1:1). Se mantiene la prohibición de vuelo sobre concentraciones de personas.\n\nLos pilotos deben completar el curso online A1/A3, superar el examen de la subcategoría A2, y realizar autoformación práctica en una zona aislada a 150 m de zonas residenciales, comerciales, industriales o recreativas.\n\nDesde el 1 de enero de 2024, es requisito indispensable disponer de un UAS con marcado de clase C2 para operaciones en subcategoría A2.",
    "duration": "40 horas",
    "modality": "online",
    "sort_order": 2,
    "sections": [
      {
        "title": "Completar el curso de formación online A1/A3 y superar el examen online",
        "body": ""
      },
      {
        "title": "Superar un examen de conocimientos teóricos adicional para la subcategoría A2",
        "body": ""
      },
      {
        "title": "Familiarización con las instrucciones del fabricante del UAS",
        "body": ""
      },
      {
        "title": "Autoformación práctica en zona aislada (150 m de zonas residenciales)",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "A2",
      "original_summary": "Certificación EASA para operar drones con UAS de clase C2 cercanos a personas no participantes. Formación 100% online según el temario oficial de AESA.",
      "original_modality": "online",
      "icon": "GraduationCap",
      "hero_parts": [
        {
          "text": "Piloto UAS",
          "highlight": false
        },
        {
          "text": "A2",
          "highlight": true
        }
      ],
      "badge": "Categoría Abierta — Subcategoría A2",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "100% Online",
      "certification": "EASA A2",
      "description_heading": "Sobre el curso",
      "topics_heading": "Requisitos del piloto",
      "cta": {
        "heading": "¿Quieres certificarte en A2?",
        "description": "Formación 100% online según el temario oficial de AESA. Contacta con nosotros para información sobre próximas convocatorias y precios.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación A2 | UASSPAIN",
        "description": "Información del programa de formación A2 de UASSPAIN."
      }
    }
  },
  {
    "name": "STS — General",
    "slug": "easa/sts",
    "category": "easa",
    "short_description": "Curso preparación examen teórico de escenarios operacionales (STS) — formación avanzada para pilotos con certificación A2 que buscan operar en categoría específica.",
    "description": "Este curso está diseñado para pilotos que ya poseen la titulación A2 y desean obtener la autorización para operar en escenarios de categoría específica. Cubre la normativa completa de escenarios operacionales STS-01 (VLOS en entorno poblado) y STS-02 (BVLOS en entorno poco poblado), según el Reglamento europeo 1139/2018 y sus actos delegados y de ejecución.\n\nEl temario incluye la reglamentación europea de aviación (EASA, OACI, Cielo Único Europeo), limitaciones del rendimiento humano (percepción visual, fatiga, condiciones meteorológicas), procedimientos operacionales (previos, durante y posteriores al vuelo), y atenuaciones técnicas y operacionales del riesgo en aire.\n\nTambién aborda el conocimiento técnico avanzado de UAS: sistemas de asistencia al vuelo, sensores (GNSS, inerciales, barométricos), principios de mando y control, frecuencias de enlace, modos de vuelo, y requisitos específicos de las clases C5 y C6. Incluye familiarización con el manual de usuario del fabricante.",
    "duration": "40 horas",
    "modality": "online",
    "sort_order": 3,
    "sections": [
      {
        "title": "Reglamentación de la aviación",
        "body": "Introducción a EASA, OACI, Cielo Único Europeo (CUE), Reglamentos europeos 1139/2018, 945/2019 y 947/2019. Registro de operadores, declaración operacional, responsabilidades del operador y del piloto."
      },
      {
        "title": "Escenarios estándar STS-01 y STS-02",
        "body": "Requisitos del STS-01 (VLOS sobre entorno poblado con clase C5) y STS-02 (BVLOS sobre entorno poco poblado con clase C6). Limitaciones, requisitos de observadores, sistemas de identificación a distancia."
      },
      {
        "title": "Limitaciones del rendimiento humano",
        "body": "Influencia de sustancias psicoactivas, alcohol, fatiga y medicación. Efecto de condiciones meteorológicas. Percepción humana, factores de alcance visual VLOS, evaluación de distancia y velocidad, consciencia situacional."
      },
      {
        "title": "Procedimientos operacionales",
        "body": "Procedimientos previos al vuelo (planificación, verificación del UAS, listas de control), durante el vuelo (normales, contingencia y emergencia), y posteriores al vuelo (inspección, registros, informes)."
      },
      {
        "title": "Atenuaciones técnicas y operacionales del riesgo",
        "body": "Riesgo en aire, volúmenes operacionales y de contingencia, geografía de vuelo, consulta de espacio aéreo, coordinación con gestores de aeródromos, fraseología con observadores del espacio aéreo."
      },
      {
        "title": "Conocimiento general del UAS",
        "body": "Principios de vuelo avanzados, sistemas de asistencia al vuelo (ESC, controladora, sensores GNSS, inerciales, barométricos), principios de mando y control, frecuencias y espectro, modos de vuelo, requisitos clase C5 y C6."
      }
    ],
    "presentation": {
      "original_name": "STS — General",
      "original_summary": "Curso preparación examen teórico de escenarios operacionales (STS) — formación avanzada para pilotos con certificación A2 que buscan operar en categoría específica.",
      "original_modality": "online",
      "icon": "Plane",
      "hero_parts": [
        {
          "text": "Piloto UAS",
          "highlight": false
        },
        {
          "text": "STS",
          "highlight": true
        }
      ],
      "badge": "Categoría Específica",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "100% Online — Ritmo propio",
      "certification": "EASA STS",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Listo para operar en categoría específica?",
        "description": "Accede al curso completo 100% online y prepárate para los escenarios STS-01 y STS-02 con el temario oficial de AESA.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación STS | UASSPAIN",
        "description": "Información del programa de formación STS de UASSPAIN."
      }
    }
  },
  {
    "name": "STS-01 — VLOS Poblado",
    "slug": "easa/sts-01",
    "category": "easa",
    "short_description": "Escenario operacional STS-01 — Vuelo visual (VLOS) sobre entorno poblado con drones de clase C5.",
    "description": "El escenario operacional STS-01 permite realizar operaciones VLOS (Vuelo Visual) sobre entorno poblado con drones de la clase C5. Este curso prepara al piloto para superar el examen teórico de AESA y obtener la autorización correspondiente.\n\nCubre la normativa específica para operaciones en áreas pobladas, incluyendo requisitos de distancia de seguridad, procedimientos de emergencia, coordinación con autoridades locales y uso obligatorio de sistemas de identificación remota.\n\nEl alumno adquirirá conocimientos sobre planificación de vuelo en entorno urbano, evaluación de riesgos específicos, y procedimientos operacionales para garantizar la seguridad de terceros durante las operaciones.",
    "duration": "20 horas",
    "modality": "online",
    "sort_order": 4,
    "sections": [
      {
        "title": "Reglamentación EASA para STS-01",
        "body": "Marco normativo europeo: Reglamento 1139/2018, actos delegados 945/2019 y 947/2019. Requisitos para operar en escenario STS-01."
      },
      {
        "title": "Operaciones VLOS en entorno poblado",
        "body": "Condiciones operacionales para vuelo visual (VLOS) sobre áreas pobladas. Requisitos de observadores, distancias de seguridad y procedimientos."
      },
      {
        "title": "Clase C5 — Requisitos del UAS",
        "body": "Características técnicas obligatorias para drones clase C5: identificación remota, geo-awareness, límites de altura y distancia, corte de motor remoto."
      },
      {
        "title": "Limitaciones del rendimiento humano",
        "body": "Percepción visual, alcance visual efectivo, factores de fatiga, condiciones meteorológicas adversas y su impacto en operaciones VLOS."
      },
      {
        "title": "Procedimientos operacionales STS-01",
        "body": "Planificación de vuelo, listas de control, procedimientos de contingencia, coordinación con servicios de tránsito aéreo en entorno poblado."
      },
      {
        "title": "Atenuaciones de riesgo",
        "body": "Evaluación de riesgos específicos para operaciones sobre entorno poblado. Volúmenes operacionales y de contingencia, geografía de vuelo."
      }
    ],
    "presentation": {
      "original_name": "STS-01 — VLOS Poblado",
      "original_summary": "Escenario operacional STS-01 — Vuelo visual (VLOS) sobre entorno poblado con drones de clase C5.",
      "original_modality": "online",
      "icon": "Plane",
      "hero_parts": [
        {
          "text": "Piloto UAS",
          "highlight": false
        },
        {
          "text": "STS-01",
          "highlight": true
        }
      ],
      "badge": "Escenario Operacional",
      "back": {
        "href": "/formacion/easa/sts",
        "label": "Volver a STS"
      },
      "format_label": "100% Online",
      "certification": "EASA STS-01",
      "description_heading": "Sobre el curso STS-01",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Quieres operar en entorno poblado?",
        "description": "Accede al curso STS-01 100% online y obtén la autorización para operar VLOS sobre áreas pobladas.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación STS 01 | UASSPAIN",
        "description": "Información del programa de formación STS 01 de UASSPAIN."
      }
    }
  },
  {
    "name": "STS-02 — BVLOS",
    "slug": "easa/sts-02",
    "category": "easa",
    "short_description": "Escenario operacional STS-02 — Vuelo fuera de línea de visión (BVLOS) sobre entorno poco-poblado con drones de clase C6.",
    "description": "El escenario operacional STS-02 permite realizar operaciones BVLOS (Fuera de Línea de Visión) sobre entorno poco-poblado con drones de la clase C6. Este curso prepara al piloto para superar el examen teórico de AESA y obtener la autorización para operaciones de largo alcance.\n\nCubre la normativa específica para operaciones fuera de línea de visión, incluyendo sistemas de detección y evitación (DAA), redundancia de enlace de control, procedimientos de emergencia para operaciones remotas y coordinación con servicios de tránsito aéreo.\n\nEl alumno adquirirá conocimientos sobre planificación de vuelo BVLOS, gestión de espacio aéreo, sistemas de monitorización en tiempo real, y procedimientos de contingencia para operaciones sin supervisión visual directa.",
    "duration": "20 horas",
    "modality": "online",
    "sort_order": 5,
    "sections": [
      {
        "title": "Reglamentación EASA para STS-02",
        "body": "Marco normativo europeo para operaciones BVLOS: Reglamento 1139/2018, actos delegados 945/2019 y 947/2019. Requisitos específicos del escenario STS-02."
      },
      {
        "title": "Operaciones BVLOS en entorno poco poblado",
        "body": "Condiciones para vuelo fuera de línea de visión (BVLOS) sobre áreas poco-pobladas. Requisitos de vigilancia, sistemas de detección y procedimientos."
      },
      {
        "title": "Clase C6 — Requisitos del UAS",
        "body": "Características técnicas para drones clase C6: sistemas de detección y evitación (DAA), redundancia de enlace, plan de emergencia, límites operacionales."
      },
      {
        "title": "Gestión del espacio aéreo",
        "body": "Consultas de espacio aéreo, coordinación con gestores de aeródromos, zonas restringidas, procedimientos de comunicación con ATC para operaciones BVLOS."
      },
      {
        "title": "Procedimientos operacionales STS-02",
        "body": "Planificación avanzada de vuelo BVLOS, procedimientos de contingencia y emergencia, monitorización en tiempo real, cadenas de mando."
      },
      {
        "title": "Atenuaciones de riesgo BVLOS",
        "body": "Evaluación de riesgos para operaciones sin línea de visión. Sistemas de alerta temprana, procedimientos de abort, cobertura de seguros obligatoria."
      }
    ],
    "presentation": {
      "original_name": "STS-02 — BVLOS",
      "original_summary": "Escenario operacional STS-02 — Vuelo fuera de línea de visión (BVLOS) sobre entorno poco-poblado con drones de clase C6.",
      "original_modality": "online",
      "icon": "Plane",
      "hero_parts": [
        {
          "text": "Piloto UAS",
          "highlight": false
        },
        {
          "text": "STS-02",
          "highlight": true
        }
      ],
      "badge": "Escenario Operacional",
      "back": {
        "href": "/formacion/easa/sts",
        "label": "Volver a STS"
      },
      "format_label": "100% Online",
      "certification": "EASA STS-02",
      "description_heading": "Sobre el curso STS-02",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Quieres operar BVLOS?",
        "description": "Accede al curso STS-02 100% online y obtén la autorización para operaciones fuera de línea de visión.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación STS 02 | UASSPAIN",
        "description": "Información del programa de formación STS 02 de UASSPAIN."
      }
    }
  },
  {
    "name": "Radiofonista UAS",
    "slug": "no-easa/radiofonista",
    "category": "non_easa",
    "short_description": "Formación en comunicaciones radio para operadores de drones en entornos profesionales y operaciones coordinadas.",
    "description": "La certificación de radiofonista es esencial para operadores de drones que trabajan en entornos profesionales donde la coordinación por radio es necesaria: operaciones cerca de aeropuertos, zonas restringidas o misiones con múltiples drones.\n\nAprenderás a establecer y mantener comunicaciones efectivas con torre de control, otros pilotos y el equipo de tierra durante las operaciones.\n\nEste curso no reemplaza la certificación EASA, pero es un complemento invaluable para pilotos que buscan operar en escenarios profesionales complejos.",
    "duration": "20 horas",
    "modality": "presencial",
    "sort_order": 6,
    "sections": [
      {
        "title": "Fundamentos de radiofonía para operaciones con drones",
        "body": ""
      },
      {
        "title": "Protocolos de comunicación y uso del canal de radio",
        "body": ""
      },
      {
        "title": "Normativa de uso del espectro radioeléctrico en España",
        "body": ""
      },
      {
        "title": "Coordinación con torre de control y servicios de tránsito",
        "body": ""
      },
      {
        "title": "Práctica de comunicaciones en entornos operacionales",
        "body": ""
      },
      {
        "title": "Evaluación final y certificado de aptitud",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "Radiofonista UAS",
      "original_summary": "Formación en comunicaciones radio para operadores de drones en entornos profesionales y operaciones coordinadas.",
      "original_modality": "presencial",
      "icon": "RadioTower",
      "hero_parts": [
        {
          "text": "Certificado de",
          "highlight": false
        },
        {
          "text": "Radiofonista",
          "highlight": true
        }
      ],
      "badge": "Cursos no EASA",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Presencial",
      "certification": "Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Necesitas certificado de radiofonista?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación RADIOFONISTA | UASSPAIN",
        "description": "Información del programa de formación RADIOFONISTA de UASSPAIN."
      }
    }
  },
  {
    "name": "Seguridad",
    "slug": "no-easa/seguridad",
    "category": "non_easa",
    "short_description": "Seguridad operacional, evaluación de riesgos, procedimientos de emergencia, normativa de seguridad en operaciones con drones.",
    "description": "La seguridad operacional es un pilar fundamental en cualquier operación con drones. Este curso proporciona los conocimientos y herramientas necesarios para identificar, evaluar y mitigar riesgos en cada fase de una operación UAS.\n\nAprenderás a implementar procedimientos de emergencia efectivos, a gestionar situaciones de crisis y a aplicar la normativa de seguridad vigente en operaciones con drones.\n\nEste curso es imprescindible para operadores que buscan garantizar la seguridad de sus operaciones y cumplir con los estándares más exigentes del sector.",
    "duration": "16 horas",
    "modality": "presencial",
    "sort_order": 7,
    "sections": [
      {
        "title": "Evaluación de riesgos operacionales",
        "body": ""
      },
      {
        "title": "Procedimientos de emergencia y contingencia",
        "body": ""
      },
      {
        "title": "Uso de EPIs y seguridad en tierra",
        "body": ""
      },
      {
        "title": "Seguridad en zonas restringidas",
        "body": ""
      },
      {
        "title": "Protocolos de comunicación de seguridad",
        "body": ""
      },
      {
        "title": "Auditoría e informes de seguridad",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "Seguridad",
      "original_summary": "Seguridad operacional, evaluación de riesgos, procedimientos de emergencia, normativa de seguridad en operaciones con drones.",
      "original_modality": "presencial",
      "icon": "Shield",
      "hero_parts": [
        {
          "text": "Seguridad",
          "highlight": false
        },
        {
          "text": "Operacional con Drones",
          "highlight": true
        }
      ],
      "badge": "Cursos no EASA",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Online / Presencial",
      "certification": "Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Necesitas formación en seguridad operacional?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación SEGURIDAD | UASSPAIN",
        "description": "Información del programa de formación SEGURIDAD de UASSPAIN."
      }
    }
  },
  {
    "name": "Emergencias / APO",
    "slug": "no-easa/emergencias-apo",
    "category": "non_easa",
    "short_description": "Formación en emergencias, APO (Áreas de Prohibición de Operación), protocolos de actuación en situaciones de emergencia con drones.",
    "description": "La gestión de emergencias y el conocimiento de las Áreas de Prohibición de Operación son competencias esenciales para cualquier piloto de drones profesional. Este curso prepara a los operadores para responder de forma rápida y efectiva ante cualquier situación de emergencia.\n\nAprenderás a identificar y gestionar las APO, a establecer cadenas de mando efectivas y a coordinarte con los servicios de emergencia en caso de incidente.\n\nEl curso incluye simulacros prácticos que permiten experimentar situaciones reales de emergencia en un entorno controlado, reforzando los protocolos aprendidos.",
    "duration": "24 horas",
    "modality": "presencial",
    "sort_order": 8,
    "sections": [
      {
        "title": "Tipología de emergencias en operaciones UAS",
        "body": ""
      },
      {
        "title": "Áreas de Prohibición de Operación (APO)",
        "body": ""
      },
      {
        "title": "Protocolos de actuación y cadena de mando",
        "body": ""
      },
      {
        "title": "Coordinación con servicios de emergencia",
        "body": ""
      },
      {
        "title": "Simulacros y ejercicios prácticos",
        "body": ""
      },
      {
        "title": "Documentación y notificación de incidentes",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "Emergencias / APO",
      "original_summary": "Formación en emergencias, APO (Áreas de Prohibición de Operación), protocolos de actuación en situaciones de emergencia con drones.",
      "original_modality": "presencial",
      "icon": "Siren",
      "hero_parts": [
        {
          "text": "Emergencias y",
          "highlight": false
        },
        {
          "text": "APO",
          "highlight": true
        }
      ],
      "badge": "Cursos no EASA",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Presencial",
      "certification": "Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Necesitas formación en emergencias y APO?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación EMERGENCIAS APO | UASSPAIN",
        "description": "Información del programa de formación EMERGENCIAS APO de UASSPAIN."
      }
    }
  },
  {
    "name": "EN01",
    "slug": "no-easa/en01",
    "category": "non_easa",
    "short_description": "Formación para operadores UAS nivel EN01, operaciones básicas en entorno controlado.",
    "description": "El nivel EN01 es el primer paso para operadores que desean trabajar en entornos controlados. Este curso proporciona las bases normativas y operativas necesarias para realizar operaciones básicas con drones de forma segura y legal.\n\nAprenderás a coordinar con el control de tránsito aéreo, a utilizar sistemas de identificación y a planificar vuelos básicos cumpliendo la normativa vigente.\n\nAl completar este curso, estarás preparado para operar en entornos controlados con la formación necesaria que exige la normativa española.",
    "duration": "12 horas",
    "modality": "online",
    "sort_order": 9,
    "sections": [
      {
        "title": "Normativa básica para operadores EN01",
        "body": ""
      },
      {
        "title": "Operaciones en entorno controlado",
        "body": ""
      },
      {
        "title": "Procedimientos de coordinación con ATC",
        "body": ""
      },
      {
        "title": "Uso de sistemas de identificación",
        "body": ""
      },
      {
        "title": "Planificación de vuelo básico",
        "body": ""
      },
      {
        "title": "Evaluación práctica",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "EN01",
      "original_summary": "Formación para operadores UAS nivel EN01, operaciones básicas en entorno controlado.",
      "original_modality": "online",
      "icon": "RadioTower",
      "hero_parts": [
        {
          "text": "Operador",
          "highlight": false
        },
        {
          "text": "EN01",
          "highlight": true
        }
      ],
      "badge": "Cursos no EASA",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Online",
      "certification": "Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Necesitas formación como operador EN01?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación EN01 | UASSPAIN",
        "description": "Información del programa de formación EN01 de UASSPAIN."
      }
    }
  },
  {
    "name": "EN02",
    "slug": "no-easa/en02",
    "category": "non_easa",
    "short_description": "Formación avanzada para operadores UAS nivel EN02, operaciones complejas en entorno no controlado.",
    "description": "El nivel EN02 permite realizar operaciones más complejas en entornos no controlados. Este curso avanza sobre las bases del EN01 y prepara a los operadores para escenarios operacionales de mayor dificultad y responsabilidad.\n\nAprenderás a gestionar el espacio aéreo, a coordinar con otros operadores y a aplicar procedimientos de contingencia avanzados para garantizar la seguridad en cada misión.\n\nEste nivel es fundamental para pilotos que buscan ampliar sus capacidades operativas y acceder a un mayor rango de oportunidades profesionales en el sector UAS.",
    "duration": "16 horas",
    "modality": "online",
    "sort_order": 10,
    "sections": [
      {
        "title": "Normativa avanzada para operadores EN02",
        "body": ""
      },
      {
        "title": "Operaciones en entorno no controlado",
        "body": ""
      },
      {
        "title": "Gestión de espacio aéreo",
        "body": ""
      },
      {
        "title": "Procedimientos de contingencia avanzados",
        "body": ""
      },
      {
        "title": "Coordinación con otros operadores",
        "body": ""
      },
      {
        "title": "Evaluación práctica avanzada",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "EN02",
      "original_summary": "Formación avanzada para operadores UAS nivel EN02, operaciones complejas en entorno no controlado.",
      "original_modality": "online",
      "icon": "RadioTower",
      "hero_parts": [
        {
          "text": "Operador",
          "highlight": false
        },
        {
          "text": "EN02",
          "highlight": true
        }
      ],
      "badge": "Cursos no EASA",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Online",
      "certification": "Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Necesitas formación como operador EN02?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación EN02 | UASSPAIN",
        "description": "Información del programa de formación EN02 de UASSPAIN."
      }
    }
  },
  {
    "name": "Operadores SOC",
    "slug": "no-easa/operadores-soc",
    "category": "non_easa",
    "short_description": "Formación para operadores SOC (Servicio de Observación con drones), vigilancia y seguridad.",
    "description": "Los Servicios de Observación con drones (SOC) son una especialidad en crecimiento dentro del sector UAS. Este curso prepara a los operadores para realizar misiones de vigilancia, inspección y seguridad utilizando drones.\n\nAprenderás a manejar equipos y sensores especializados, a coordinar con fuerzas de seguridad y a recopilar y analizar datos de forma efectiva para cada misión de observación.\n\nEl curso cubre el marco normativo específico para operaciones SOC y prepara a los pilotos para certificarse como operadores especializados en vigilancia con drones.",
    "duration": "20 horas",
    "modality": "presencial",
    "sort_order": 11,
    "sections": [
      {
        "title": "Marco normativo SOC",
        "body": ""
      },
      {
        "title": "Equipos y sensores para observación",
        "body": ""
      },
      {
        "title": "Procedimientos de vigilancia",
        "body": ""
      },
      {
        "title": "Coordinación con fuerzas de seguridad",
        "body": ""
      },
      {
        "title": "Recopilación y análisis de datos",
        "body": ""
      },
      {
        "title": "Evaluación y certificación",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "Operadores SOC",
      "original_summary": "Formación para operadores SOC (Servicio de Observación con drones), vigilancia y seguridad.",
      "original_modality": "presencial",
      "icon": "Shield",
      "hero_parts": [
        {
          "text": "Operadores",
          "highlight": false
        },
        {
          "text": "SOC",
          "highlight": true
        }
      ],
      "badge": "Cursos no EASA",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Online / Presencial",
      "certification": "Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Necesitas formación como operador SOC?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación OPERADORES SOC | UASSPAIN",
        "description": "Información del programa de formación OPERADORES SOC de UASSPAIN."
      }
    }
  },
  {
    "name": "Certificación de Instructor",
    "slug": "instructor/certificacion",
    "category": "instructor",
    "short_description": "Formación completa para obtener la certificación de instructor UAS, capacitación para enseñar y evaluar pilotos.",
    "description": "La certificación de instructor UAS es el nivel más alto en la cadena de formación de pilotos de drones. Este curso capacita a los profesionales para enseñar, formar y evaluar a futuros pilotos UAS.\n\nAprenderás metodologías de enseñanza efectivas, a planificar cursos completos y a evaluar las competencias de los pilotos conforme a los estándares EASA.\n\nEl curso incluye prácticas de instrucción supervisada que permiten adquirir experiencia real antes de obtener la certificación oficial.",
    "duration": "40 horas",
    "modality": "presencial",
    "sort_order": 12,
    "sections": [
      {
        "title": "Metodología de enseñanza para UAS",
        "body": ""
      },
      {
        "title": "Planificación de cursos y programas",
        "body": ""
      },
      {
        "title": "Evaluación de competencias de pilotos",
        "body": ""
      },
      {
        "title": "Normativa de formación EASA",
        "body": ""
      },
      {
        "title": "Prácticas de instrucción supervisada",
        "body": ""
      },
      {
        "title": "Examen y certificación",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "Certificación de Instructor",
      "original_summary": "Formación completa para obtener la certificación de instructor UAS, capacitación para enseñar y evaluar pilotos.",
      "original_modality": "presencial",
      "icon": "GraduationCap",
      "hero_parts": [
        {
          "text": "Certificación de",
          "highlight": false
        },
        {
          "text": "Instructor",
          "highlight": true
        }
      ],
      "badge": "Instructor UAS",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Presencial",
      "certification": "EASA / Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Quieres certificarte como instructor UAS?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación CERTIFICACION | UASSPAIN",
        "description": "Información del programa de formación CERTIFICACION de UASSPAIN."
      }
    }
  },
  {
    "name": "Revalidación de Instructor",
    "slug": "instructor/revalidacion",
    "category": "instructor",
    "short_description": "Revalidación de la certificación de instructor UAS, actualización normativa y metodológica.",
    "description": "La revalidación de la certificación de instructor UAS es obligatoria para mantenerse al día con los últimos cambios normativos y tecnológicos del sector.\n\nEste curso actualiza a los instructores en las nuevas tecnologías de plataformas UAS, metodologías de enseñanza actualizadas y los cambios más recientes en la normativa EASA.\n\nIncluye prácticas de reciclaje y un examen de revalidación que garantiza que los instructores mantienen el nivel de competencia requerido.",
    "duration": "16 horas",
    "modality": "presencial",
    "sort_order": 13,
    "sections": [
      {
        "title": "Actualización normativa EASA",
        "body": ""
      },
      {
        "title": "Nuevas tecnologías y plataformas",
        "body": ""
      },
      {
        "title": "Metodologías de enseñanza actualizadas",
        "body": ""
      },
      {
        "title": "Evaluación de competencias actualizadas",
        "body": ""
      },
      {
        "title": "Prácticas de reciclaje",
        "body": ""
      },
      {
        "title": "Examen de revalidación",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "Revalidación de Instructor",
      "original_summary": "Revalidación de la certificación de instructor UAS, actualización normativa y metodológica.",
      "original_modality": "presencial",
      "icon": "GraduationCap",
      "hero_parts": [
        {
          "text": "Revalidación de",
          "highlight": false
        },
        {
          "text": "Instructor",
          "highlight": true
        }
      ],
      "badge": "Instructor UAS",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Online / Presencial",
      "certification": "EASA / Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Necesitas revalidar tu certificación de instructor?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación REVALIDACION | UASSPAIN",
        "description": "Información del programa de formación REVALIDACION de UASSPAIN."
      }
    }
  },
  {
    "name": "Formación Continua",
    "slug": "instructor/continua",
    "category": "instructor",
    "short_description": "Programas de formación continua para instructores y pilotos profesionales, mantenimiento de competencias.",
    "description": "La formación continua es esencial para instructores y pilotos profesionales que desean mantenerse a la vanguardia del sector UAS. Este programa ofrece actualizaciones periódicas sobre nuevas tecnologías, normativa y mejores prácticas.\n\nA través de talleres, seminarios y módulos especializados, los profesionales pueden ampliar sus conocimientos en tecnología emergente, nuevos escenarios operacionales y gestión de riesgos avanzada.\n\nEste programa es ideal para mantener las competencias actualizadas y obtener certificaciones complementarias que enriquezcan el perfil profesional en el sector drones.",
    "duration": "Variable",
    "modality": "presencial",
    "sort_order": 14,
    "sections": [
      {
        "title": "Actualización de conocimientos técnicos",
        "body": ""
      },
      {
        "title": "Nuevos escenarios operacionales",
        "body": ""
      },
      {
        "title": "Seguridad y gestión de riesgos",
        "body": ""
      },
      {
        "title": "Tecnología emergente en UAS",
        "body": ""
      },
      {
        "title": "Talleres y seminarios",
        "body": ""
      },
      {
        "title": "Certificaciones complementarias",
        "body": ""
      }
    ],
    "presentation": {
      "original_name": "Formación Continua",
      "original_summary": "Programas de formación continua para instructores y pilotos profesionales, mantenimiento de competencias.",
      "original_modality": "presencial",
      "icon": "GraduationCap",
      "hero_parts": [
        {
          "text": "Formación",
          "highlight": false
        },
        {
          "text": "Continua",
          "highlight": true
        }
      ],
      "badge": "Instructor UAS",
      "back": {
        "href": "/formacion",
        "label": "Volver a Formación"
      },
      "format_label": "Online / Presencial",
      "certification": "Interna",
      "description_heading": "Sobre el curso",
      "topics_heading": "Módulos del Curso",
      "cta": {
        "heading": "¿Quieres mantenerte actualizado en formación UAS?",
        "description": "Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.",
        "label": "Solicitar Información",
        "href": "/contacto"
      },
      "seo": {
        "title": "Formación CONTINUA | UASSPAIN",
        "description": "Información del programa de formación CONTINUA de UASSPAIN."
      }
    }
  }
]
$legacy_courses$::jsonb)
), inserted AS (
    INSERT INTO courses (id,name,slug,short_description,description,modality,duration,category,
                         status,sort_order,published_at,presentation)
    SELECT gen_random_uuid(), data->>'name', data->>'slug', data->>'short_description',
           data->>'description', data->>'modality', data->>'duration', data->>'category',
           'published', (data->>'sort_order')::integer, NOW(), data->'presentation'
    FROM legacy
    WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.slug=data->>'slug' OR lower(c.name)=lower(data->>'name'))
    ON CONFLICT (slug) DO NOTHING
    RETURNING id,slug
)
INSERT INTO course_sections (id,course_id,title,body,sort_order)
SELECT gen_random_uuid(), inserted.id, topic.value->>'title', topic.value->>'body', (topic.ordinality-1)::integer
FROM legacy JOIN inserted ON inserted.slug=legacy.data->>'slug'
CROSS JOIN LATERAL jsonb_array_elements(legacy.data->'sections') WITH ORDINALITY AS topic(value,ordinality);

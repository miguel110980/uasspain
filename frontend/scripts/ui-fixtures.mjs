// Synthetic browser fixtures. All API and WebSocket traffic is intercepted.
export default {
  "results": [
    { "id": "30000000-0000-4000-8000-000000000001", "alumno_id": "00000000-0000-4000-8000-000000000003", "examen_nombre": "Prueba visual A1/A3", "categoria": "A1/A3", "modalidad": "libre", "nota": 5, "porcentaje": 50, "aciertos": 20, "errores": 20, "aprobado": false, "fecha": "2026-10-21T10:00:00Z", "created_date": "2026-10-21T10:00:00Z" },
    { "id": "30000000-0000-4000-8000-000000000002", "alumno_id": "00000000-0000-4000-8000-000000000003", "examen_nombre": "Prueba visual A1/A3", "categoria": "A1/A3", "modalidad": "libre", "nota": 8, "porcentaje": 80, "aciertos": 32, "errores": 8, "aprobado": true, "fecha": "2026-10-22T10:00:00Z", "created_date": "2026-10-22T10:00:00Z" }
  ],
  "courses": [
    {
      "id": "20000000-0000-4000-8000-000000000001",
      "name": "Curso de auditor?a 1",
      "slug": "audit/curso-1",
      "category": "easa",
      "short_description": "Curso sint?tico para comprobar tarjetas y plantilla compartida.",
      "description": "Contenido de prueba del curso.",
      "modality": "online",
      "duration": "20 horas",
      "status": "published",
      "cover_image_url": "",
      "sort_order": 0,
      "content_available": true,
      "sections": [
        {
          "id": "section-0",
          "course_id": "course-0",
          "title": "Temario de prueba",
          "body": "Contenido del m?dulo de formaci?n.",
          "sort_order": 0
        }
      ]
    },
    {
      "id": "20000000-0000-4000-8000-000000000002",
      "name": "Curso de auditor?a 2",
      "slug": "audit/curso-2",
      "category": "non_easa",
      "short_description": "Curso sint?tico para comprobar tarjetas y plantilla compartida.",
      "description": "Contenido de prueba del curso.",
      "modality": "presencial_online",
      "duration": "20 horas",
      "status": "published",
      "cover_image_url": "",
      "sort_order": 1,
      "content_available": true,
      "sections": [
        {
          "id": "section-1",
          "course_id": "course-1",
          "title": "Temario de prueba",
          "body": "Contenido del m?dulo de formaci?n.",
          "sort_order": 0
        }
      ]
    },
    {
      "id": "20000000-0000-4000-8000-000000000003",
      "name": "Curso de auditor?a 3",
      "slug": "audit/curso-3",
      "category": "instructor",
      "short_description": "Curso sint?tico para comprobar tarjetas y plantilla compartida.",
      "description": "Contenido de prueba del curso.",
      "modality": "online",
      "duration": "20 horas",
      "status": "upcoming",
      "cover_image_url": "",
      "sort_order": 2,
      "content_available": false,
      "sections": [
        {
          "id": "section-2",
          "course_id": "course-2",
          "title": "Temario de prueba",
          "body": "Contenido del m?dulo de formaci?n.",
          "sort_order": 0
        }
      ]
    },
    {
      "id": "20000000-0000-4000-8000-000000000004",
      "name": "Curso de auditor?a 4",
      "slug": "audit/curso-4",
      "category": "other",
      "short_description": "Curso sint?tico para comprobar tarjetas y plantilla compartida.",
      "description": "Contenido de prueba del curso.",
      "modality": "presencial_online",
      "duration": "20 horas",
      "status": "published",
      "cover_image_url": "",
      "sort_order": 3,
      "content_available": true,
      "sections": [
        {
          "id": "section-3",
          "course_id": "course-3",
          "title": "Temario de prueba",
          "body": "Contenido del m?dulo de formaci?n.",
          "sort_order": 0
        }
      ]
    }
  ],
  "profiles": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "user_id": "10000000-0000-4000-8000-000000000001",
      "role": "admin",
      "roles": [
        "admin"
      ],
      "status": "activo",
      "nombre": "Auditoría",
      "apellidos": "Frontend admin",
      "email": "admin@example.invalid",
      "created_date": "2026-10-03T23:19:26.319Z",
      "assigned_instructor_id": null,
      "curso": "A1/A3"
    },
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "user_id": "10000000-0000-4000-8000-000000000002",
      "role": "instructor",
      "roles": [
        "instructor"
      ],
      "status": "activo",
      "nombre": "Auditoría",
      "apellidos": "Frontend instructor",
      "email": "instructor@example.invalid",
      "created_date": "2026-10-03T23:19:26.320Z",
      "assigned_instructor_id": null,
      "curso": "A1/A3"
    },
    {
      "id": "00000000-0000-4000-8000-000000000003",
      "user_id": "10000000-0000-4000-8000-000000000003",
      "role": "alumno",
      "roles": [
        "alumno"
      ],
      "status": "activo",
      "nombre": "Alumno",
      "apellidos": "Prueba responsive",
      "email": "alumno@example.invalid",
      "created_date": "2026-10-03T23:19:26.320Z",
      "assigned_instructor_id": "00000000-0000-4000-8000-000000000002",
      "curso": "A1/A3"
    }
  ],
  "status": {
    "platform": {
      "name": "UASSPAIN",
      "production": true,
      "frontend_url": "https://localhost",
      "timezone": "Europe/Madrid",
      "database_connected": true
    },
    "backend": {
      "status": "ok",
      "runtime": "Rust",
      "uptime_seconds": 600
    },
    "database": {
      "status": "ok",
      "connected": true
    },
    "redis": {
      "status": "ok",
      "configured": true,
      "connected": true,
      "backend": "redis"
    },
    "websockets": {
      "status": "ok",
      "operational": true,
      "backend": "redis"
    },
    "smtp": {
      "enabled": false,
      "configured": false,
      "host": "",
      "password_configured": false
    },
    "google_oauth": {
      "enabled": false,
      "configured": false,
      "client_id": "",
      "origins": []
    },
    "users": {
      "total": 3,
      "unique_active": 3,
      "admin": 1,
      "instructor": 1,
      "alumno": 1
    },
    "academic": {
      "published_courses": 3,
      "published_news": 0,
      "available_exams": 0,
      "total_exams": 0,
      "published_materials": 0,
      "total_materials": 0,
      "exam_results": 0,
      "passed_exams": 0
    },
    "security": {
      "jwt_cookie_secure": true,
      "reverse_proxy": "nginx",
      "trust_proxy": true,
      "allowed_hosts": [
        "localhost"
      ],
      "csp": true,
      "hsts": true
    },
    "two_factor": {
      "enabled": false,
      "required_roles": []
    },
    "host": {
      "available": false,
      "scope": "container",
      "cpu": {},
      "memory": {},
      "disk": {}
    }
  }
};

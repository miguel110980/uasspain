export type SystemStatusResponse = {
  platform: { name: string; production: boolean; frontend_url: string; timezone: string; database_connected: boolean };
  backend: { status: string; runtime: string; uptime_seconds: number };
  database: { status: string; connected: boolean };
  redis: { status: string; configured: boolean; connected: boolean; backend: string };
  websockets: { status: string; backend: string; operational: boolean };
  smtp: { enabled: boolean; configured: boolean; host: string; password_configured: boolean; last_test_ok: boolean | null };
  google_oauth: { enabled: boolean; configured: boolean; client_id: string; origins: string[] };
  users: { total?: number; unique_active: number; admin: number; instructor: number; alumno: number };
  academic?: { published_courses: number; published_news: number; available_exams: number; total_exams: number; published_materials: number; total_materials: number; exam_results: number; passed_exams: number };
  security: { jwt_cookie_secure: boolean; reverse_proxy: string; trust_proxy: boolean; allowed_hosts: string[]; csp: boolean; hsts: boolean };
  two_factor: { enabled: boolean; required_roles: string[] };
  host: { available: boolean; scope: string; cpu: Record<string, unknown>; memory: Record<string, unknown>; disk: Record<string, unknown> };
};

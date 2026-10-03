"""Bounded load, expiry and dependency-failure drills for the isolated E2E stack."""
import concurrent.futures
import json
import math
import sys
import time
import urllib.parse

from e2e_api import BASE, Session, login, ADMIN_EMAIL, ADMIN_PASSWORD, ALUM_EMAIL, ALUM_PASSWORD, INSTR_EMAIL, INSTR_PASSWORD

target = urllib.parse.urlsplit(BASE)
if not (target.scheme == "http" and target.hostname == "backend-e2e" and target.port == 8000 and not target.path):
    raise SystemExit("Operations drills require the isolated backend-e2e network.")


def authenticated(email, password):
    session = Session("operations")
    ok, _ = login(session, email, password)
    assert ok, "Operations login failed"
    return session


def load():
    session = authenticated(ALUM_EMAIL, ALUM_PASSWORD)
    cookie = session.access_cookie()
    def request(index):
        started = time.perf_counter()
        status, _ = Session("load").call("GET", "/api/resultados-examen/" if index % 2 else "/api/examenes/",
            headers={"Cookie": f"uasspain_access={cookie}", "X-UASSpain-Window-Id": session.window_id}, timeout=10)
        return status, (time.perf_counter() - started) * 1000
    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as workers:
        results = list(workers.map(request, range(400)))
    latencies = sorted(duration for _, duration in results)
    p95 = latencies[math.ceil(len(latencies) * .95) - 1]
    failures = sum(status != 200 for status, _ in results)
    print(json.dumps({"requests": len(results), "concurrency": 24, "failures": failures,
        "p95_ms": round(p95, 1), "elapsed_seconds": round(time.perf_counter() - started, 2)}))
    assert failures == 0 and p95 < 2000, "Load gate failed (local bounded test, p95 target 2 seconds)"


def deadline(prepare):
    instructor = authenticated(INSTR_EMAIL, INSTR_PASSWORD)
    student = authenticated(ALUM_EMAIL, ALUM_PASSWORD)
    if prepare:
        status, existing = instructor.call("GET", "/api/examenes/")
        assert status == 200
        for exam in existing:
            if exam["nombre"] == "Operations expiry fixture":
                assert instructor.call("DELETE", f"/api/examenes/{exam['id']}/")[0] == 204
        status, exam = instructor.call("POST", "/api/examenes/", {
            "nombre": "Operations expiry fixture", "categoria": "A1/A3", "activo": True, "num_preguntas": 1})
        assert status == 201
        status, question = instructor.call("POST", "/api/preguntas/", {"examen_id": exam["id"],
            "enunciado": "Expiry fixture", "opcion_a": "Correcta", "opcion_b": "Incorrecta",
            "opcion_c": "Tercera", "opcion_d": "Cuarta", "respuesta_correcta": "a", "orden": 1})
        assert status == 201
        status, attempt = student.call("POST", f"/api/examenes/{exam['id']}/intentos/", {"modalidad": "tiempo"})
        assert status == 200
        status, _ = student.call("PUT", f"/api/intentos-examen/{attempt['id']}/", {"respuestas": {question["id"]: "a"}})
        assert status == 204
        # A teacher edit must not change the question snapshot of an ongoing attempt.
        status, _ = instructor.call("PATCH", f"/api/preguntas/{question['id']}/", {"respuesta_correcta": "b"})
        assert status == 200
        print(json.dumps({"attempt_id": attempt["id"]}))
    else:
        status, exams = student.call("GET", "/api/examenes/")
        exam = next(exam for exam in exams if exam["nombre"] == "Operations expiry fixture")
        status, attempt = student.call("POST", f"/api/examenes/{exam['id']}/intentos/", {"modalidad": "tiempo"})
        assert status == 200
        question_id = attempt["preguntas"][0]["id"]
        status, _ = student.call("PUT", f"/api/intentos-examen/{attempt['id']}/", {"respuestas": {question_id: "b"}})
        assert status == 400, "Expired attempt accepted answers"
        payload = {"examen_id": exam["id"], "attempt_id": attempt["id"], "respuestas": {question_id: "b"}}
        cookie = student.access_cookie()
        def submit(_):
            return Session("concurrent-submit").call("POST", "/api/resultados-examen/", payload,
                headers={"Cookie": f"uasspain_access={cookie}", "X-UASSpain-Window-Id": student.window_id})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(submit, range(2)))
        assert all(status == 201 and result["nota"] == 10 and result["tiempo_empleado"] == 2400 for status, result in results)
        assert results[0][1]["id"] == results[1][1]["id"], "Concurrent submission produced duplicate results"
        assert instructor.call("DELETE", f"/api/examenes/{exam['id']}/")[0] == 204
        print("PASS expiry, immutable snapshot, late answers rejected, server duration and concurrent idempotency")


def probe(mode):
    session = Session("dependency-probe")
    live, _ = session.call("GET", "/api/health/live/")
    started = time.perf_counter()
    ready, details = session.call("GET", "/api/health/ready/")
    # Container health can precede the backend subscriber's reconnect cycle.
    limit = 30 if mode == "recovered" else 3
    while (ready != 200 if mode == "recovered" else ready == 200) and time.perf_counter() - started < limit:
        time.sleep(.2)
        ready, details = session.call("GET", "/api/health/ready/")
    assert live == 200
    if mode == "recovered":
        assert ready == 200 and details["database"] and details["redis"]
        session = authenticated(ALUM_EMAIL, ALUM_PASSWORD)
        assert session.call("GET", "/api/resultados-examen/")[0] == 200
    else:
        assert ready == 503
        assert time.perf_counter() - started < 5, "Readiness stalled on dependency failure"
        if mode == "db-down":
            assert not details["database"]
        else:
            assert not details["redis"] and details["database"]
            session = authenticated(ALUM_EMAIL, ALUM_PASSWORD)
            assert session.call("POST", "/api/mensajes/", {"contenido": "Redis outage persisted message"}, timeout=8)[0] == 201
            assert session.call("GET", "/api/mensajes/")[0] == 200
    print(f"PASS {mode}: liveness, bounded readiness and dependency state")


def profile_lifecycle():
    admin = authenticated(ADMIN_EMAIL, ADMIN_PASSWORD)
    instructor = authenticated(INSTR_EMAIL, INSTR_PASSWORD)
    status, teacher = admin.call("POST", "/api/users/crear-instructor/", {
        "nombre": "Fixture", "apellidos": "Borrado", "email": "deletion-teacher@test.local",
        "username": "deletion-teacher", "dni_nie": "22222222J", "fecha_nacimiento": "1990-01-01",
        "password": "E2eDeletionTeacher_2026!", "es_admin": False})  # pragma: allowlist secret - isolated fixture
    assert status == 201, (status, teacher)
    status, student = Session("registration").call("POST", "/api/auth/register/", {
        "nombre": "Fixture", "apellidos": "Alumno borrado", "email": "deletion-student@test.local",
        "username": "deletion-student", "dni_nie": "33333333P", "fecha_nacimiento": "2000-01-01",
        "password": "E2eDeletionStudent_2026!"})  # pragma: allowlist secret - isolated fixture
    assert status == 201
    assert admin.call("POST", f"/api/profiles/{teacher['id']}/assign-alumnos/", {"student_ids": [student["id"]]})[0] == 200
    assert instructor.call("DELETE", f"/api/profiles/{student['id']}/")[0] == 403
    teacher_session = authenticated("deletion-teacher@test.local", "E2eDeletionTeacher_2026!")
    status, message = teacher_session.call("POST", "/api/mensajes/", {"alumno_id": student["id"], "contenido": "Deletion fixture"})
    assert status == 201
    assert admin.call("POST", "/api/mensajes-staff/", {"destinatario_id": teacher["id"], "contenido": "Deletion staff fixture"})[0] == 201
    status, exam = teacher_session.call("POST", "/api/examenes/", {"nombre": "Shared deletion fixture", "categoria": "A1/A3", "activo": True})
    assert status == 201
    assert admin.call("DELETE", f"/api/profiles/{teacher['id']}/")[0] == 204
    assert teacher_session.call("GET", "/api/auth/me/")[0] == 401
    status, retained = admin.call("GET", f"/api/profiles/{student['id']}/")
    assert status == 200 and retained["assigned_instructor_id"] is None
    assert admin.call("GET", f"/api/examenes/{exam['id']}/")[0] == 200
    assert admin.call("DELETE", f"/api/profiles/{student['id']}/")[0] == 204
    assert admin.call("GET", f"/api/mensajes/{message['id']}/")[0] == 404
    assert admin.call("DELETE", f"/api/examenes/{exam['id']}/")[0] == 204
    print("PASS profile lifecycle: foreign instructor denied, dependent rows deleted, students/content retained, session revoked")


def auth_case():
    expected_id = None
    for email in [INSTR_EMAIL.upper(), INSTR_EMAIL.title(), f"  {INSTR_EMAIL}  "]:
        account = authenticated(email, INSTR_PASSWORD)
        status, profile = account.call("GET", "/api/auth/me/")
        assert status == 200 and profile["email"] == INSTR_EMAIL.lower()
        expected_id = expected_id or profile["id"]
        assert profile["id"] == expected_id
    admin = authenticated(ADMIN_EMAIL, ADMIN_PASSWORD)
    student = authenticated(ALUM_EMAIL, ALUM_PASSWORD)
    status, profile = student.call("GET", "/api/auth/me/")
    assert status == 200
    status, _ = admin.call("PATCH", f"/api/profiles/{profile['id']}/", {"email": INSTR_EMAIL.upper()})
    assert status == 409, "Case variant bypassed email uniqueness"
    status, unchanged = admin.call("GET", f"/api/profiles/{profile['id']}/")
    assert status == 200 and unchanged["email"] == ALUM_EMAIL
    status, updated = admin.call("PATCH", f"/api/profiles/{profile['id']}/", {"email": f"  {ALUM_EMAIL.upper()}  "})
    assert status == 200 and updated["email"] == ALUM_EMAIL
    status, _ = admin.call("PATCH", f"/api/profiles/{profile['id']}/", {"email": "invalid@@example.com"})
    assert status == 400
    print("PASS email normalization, stable identity, unique collision rejection and profile update")


mode = sys.argv[1]
if mode == "load":
    load()
elif mode == "profile-lifecycle":
    profile_lifecycle()
elif mode == "auth-case":
    auth_case()
elif mode.startswith("deadline-"):
    deadline(mode == "deadline-prepare")
else:
    probe(mode)

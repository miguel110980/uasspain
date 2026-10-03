# E2E API contra la stack AISLADA (docker-compose.e2e.yml, puerto 8010).
# Nunca se ejecuta contra el stack principal: BASE es configurable y por defecto
# apunta a http://127.0.0.1:8010 (backend-e2e). Requiere: python + websockets.
import asyncio
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.cookiejar import CookieJar

BASE = os.environ.get("E2E_BASE", "https://localhost:8010").rstrip("/")
WS_BASE = (
    "wss://" + BASE.removeprefix("https://")
    if BASE.startswith("https://")
    else "ws://" + BASE.removeprefix("http://")
)
ORIGIN = os.environ.get("E2E_ORIGIN", "https://localhost")
CA_FILE = os.environ.get("E2E_CA_FILE", "").strip()
TLS_CONTEXT = (
    ssl.create_default_context(cafile=CA_FILE)
    if BASE.startswith("https://") and CA_FILE
    else None
)
ADMIN_EMAIL = os.environ.get("E2E_ADMIN_EMAIL", "e2e-admin@test.local")
ADMIN_PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "E2eAdmin_2026!")
INSTR_EMAIL = os.environ.get("E2E_INSTRUCTOR_EMAIL", "instructor.e2e@test.local")
INSTR_PASSWORD = os.environ.get("E2E_INSTRUCTOR_PASSWORD", "E2eInstr_2026!")
ALUM_EMAIL = os.environ.get("E2E_ALUMNO_EMAIL", "alumno.e2e@test.local")
ALUM_PASSWORD = os.environ.get("E2E_ALUMNO_PASSWORD", "E2ePass_2026!")
OUT = []
WINDOW_LOOKUPS = {}


def log(ok, name, extra=""):
    line = f"{'PASS' if ok else 'FAIL'} | {name}" + (f" | {extra}" if extra else "")
    OUT.append(line)
    print(line, flush=True)


class Session:
    def __init__(self, label):
        self.label = label
        self.window_id = str(uuid.uuid4())
        self.jar = CookieJar()
        handlers = [urllib.request.HTTPCookieProcessor(self.jar)]
        if TLS_CONTEXT is not None:
            handlers.append(urllib.request.HTTPSHandler(context=TLS_CONTEXT))
        self.opener = urllib.request.build_opener(*handlers)

    def call(
        self,
        method,
        path,
        payload=None,
        headers=None,
        raw_body=None,
        content_type=None,
        timeout=20,
    ):
        url = BASE + path
        hdrs = {"Origin": ORIGIN, "Referer": ORIGIN + "/", "X-UASSpain-Window-Id": self.window_id}
        if headers:
            hdrs.update(headers)
        data = None
        if raw_body is not None:
            data = raw_body
            hdrs["Content-Type"] = content_type
        elif payload is not None:
            data = json.dumps(payload).encode()
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                body = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                parsed = json.loads(body) if "json" in ctype and body else body
                return resp.status, parsed
        except urllib.error.HTTPError as e:
            body = e.read()
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = body
            return e.code, parsed

    def access_cookie(self):
        for c in self.jar:
            if c.name == "uasspain_access":
                WINDOW_LOOKUPS[c.value] = self.window_id
                return c.value
        return None


def login(sess, email, password):
    status, data = sess.call(
        "POST", "/api/auth/login/", {"email": email, "password": password}
    )
    if status != 200:
        return False, f"login {status}: {data}"
    status, me = sess.call("GET", "/api/auth/me/")
    if status != 200:
        return False, f"me {status}: {me}"
    return True, me


def call_post_retry(sess, path, payload, timeout=180, tries=3):
    """POST con reintento ante 409 (advisory lock del scheduler de backups)."""
    st, data = None, None
    for _ in range(tries):
        st, data = sess.call("POST", path, payload, timeout=timeout)
        if st != 409:
            return st, data
        time.sleep(3)
    return st, data


def do_restore(sess, payload, tries=4):
    """Restauración asíncrona: POST (202) + polling de estado hasta el final.

    Devuelve (200, data) si terminó done, (500, data) si terminó failed o
    (código, data) si la petición fue rechazada.
    """
    st, resp = call_post_retry(
        sess, "/api/backups/restore/", payload, timeout=60, tries=tries
    )
    if st != 202:
        return st, resp if isinstance(resp, dict) else {"error": str(resp)}
    rid = (resp or {}).get("restore_id")
    if not rid:
        return 500, {"error": "sin restore_id"}
    for _ in range(150):
        time.sleep(2)
        stt, data = sess.call(
            "GET", f"/api/backups/restore-status/?restore_id={rid}", timeout=30
        )
        if (
            stt == 200
            and isinstance(data, dict)
            and data.get("state") in ("done", "failed")
        ):
            return (200 if data.get("state") == "done" else 500), data
    return 504, {"error": "timeout esperando la restauración"}


def make_controlled_pdf(path):
    lines = [
        ("F1", "1. Cual es la altura maxima general?"),
        ("F1", "A) 120 m"),
        ("F2", "B) 150 m"),
        ("F1", "C) 200 m"),
        ("F1", "D) 400 m"),
        ("F1", "2. Que documento habilita al operador?"),
        ("F1", "A) Tarjeta de vuelo"),
        ("F2", "B) A2 certificate"),
        ("F1", "C) Permiso de dron"),
        ("F1", "D) Seguro RC"),
        ("F1", "3. Categoria para drones pesados?"),
        ("F1", "A) A1"),
        ("F1", "B) A3"),
        ("F2", "C) STS"),
        ("F1", "D) Open"),
        ("F1", "4. Que significa GNSS?"),
        ("F1", "A) Sistema global"),
        ("F2", "B) Sensores"),
        ("F1", "C) Bateria"),
        ("F2", "D) Navegacion por satelite"),
    ]
    content = ["BT"]
    y = 760
    for font, text in lines:
        safe = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        content.append(f"/{font} 12 Tf 50 {y} Td ({safe}) Tj")
        y -= 18
    content.append("ET")
    stream = "\n".join(content).encode("latin-1", "replace")

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode()
    with open(path, "wb") as fh:
        fh.write(bytes(out))


def multipart(field_file, filename, content_type):
    boundary = "----e2e" + uuid.uuid4().hex
    body = (
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        + field_file
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return body, f"multipart/form-data; boundary={boundary}"


def run_content_e2e(admin, instr):
    """Blog/Formación: flujo real contra API, con limpieza de todos los datos creados."""
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    post_ids = []
    course_ids = []

    def create_post(title, order):
        st, post = admin.call(
            "POST",
            "/api/admin/blog/posts",
            {
                "title": title,
                "body": f"Contenido público {title}",
                "status": "published",
                "sort_order": order,
            },
        )
        if st == 201 and isinstance(post, dict) and post.get("id"):
            post_ids.append(post["id"])
        return st, post

    def upload_image(post_id, filename="pixel.png", data=png):
        body, ctype = multipart(data, filename, "image/png")
        return admin.call(
            "POST",
            f"/api/admin/blog/posts/{post_id}/images",
            raw_body=body,
            content_type=ctype,
        )

    try:
        stamp = uuid.uuid4().hex[:10]
        st, text_post = create_post(f"E2E texto {stamp}", 0)
        text_id = text_post.get("id") if isinstance(text_post, dict) else None
        log(st == 201 and text_post.get("images") == [], "blog_crear_sin_imagen", f"{st}")

        st, one_post = create_post(f"E2E una imagen {stamp}", 1)
        one_id = one_post.get("id") if isinstance(one_post, dict) else None
        st_img, one_image = upload_image(one_id) if one_id else (0, {})
        log(
            st == 201 and st_img == 201,
            "blog_crear_una_imagen",
            f"{st}/{st_img} {one_image if st_img != 201 else ''}"[:240],
        )

        st, multi_post = create_post(f"E2E varias imagenes {stamp}", 2)
        multi_id = multi_post.get("id") if isinstance(multi_post, dict) else None
        multi_images = []
        for index in range(3):
            st_img, image = upload_image(multi_id, f"pixel-{index}.png") if multi_id else (0, {})
            if st_img == 201:
                multi_images.append(image)
        log(len(multi_images) == 3, "blog_varias_imagenes_sucesivas", f"{len(multi_images)}/3")

        body, ctype = multipart(b"\x89PNG\r\n\x1a\ncorrupta", "corrupta.png", "image/png")
        st_bad, bad_image = admin.call(
            "POST",
            f"/api/admin/blog/posts/{text_id}/images",
            raw_body=body,
            content_type=ctype,
        )
        log(st_bad == 400, "blog_rechaza_imagen_corrupta", f"{st_bad} {bad_image}"[:240])

        body, ctype = multipart(b"x" * (10 * 1024 * 1024 + 1), "grande.png", "image/png")
        st_big, _ = admin.call(
            "POST",
            f"/api/admin/blog/posts/{text_id}/images",
            raw_body=body,
            content_type=ctype,
        )
        log(st_big in (400, 413), "blog_rechaza_tamano_excesivo", f"{st_big}")

        st_edit, edited = admin.call(
            "PATCH",
            f"/api/admin/blog/posts/{text_id}",
            {"body": "Contenido E2E editado", "sort_order": 4},
        )
        log(st_edit == 200 and edited.get("body") == "Contenido E2E editado", "blog_editar", f"{st_edit}")

        foreign_image_id = one_image.get("id") if isinstance(one_image, dict) else None
        st_wrong, _ = admin.call(
            "DELETE", f"/api/admin/blog/posts/{multi_id}/images/{foreign_image_id}"
        )
        st_del_img, _ = admin.call(
            "DELETE", f"/api/admin/blog/posts/{one_id}/images/{foreign_image_id}"
        )
        log(st_wrong == 404 and st_del_img == 204, "blog_imagen_bloque_correcto", f"{st_wrong}/{st_del_img}")

        st_public, public_posts = admin.call("GET", "/api/blog/posts")
        public_ids = {post.get("id") for post in public_posts or []}
        log(
            st_public == 200 and {text_id, one_id, multi_id}.issubset(public_ids),
            "blog_render_publico_y_orden",
            f"{st_public}",
        )
        st_forbidden, _ = instr.call(
            "POST", "/api/admin/blog/posts", {"body": "denegado", "status": "published"}
        )
        log(st_forbidden == 403, "blog_permisos_admin", f"{st_forbidden}")

        st_delete, _ = admin.call("DELETE", f"/api/admin/blog/posts/{one_id}")
        if st_delete == 204 and one_id in post_ids:
            post_ids.remove(one_id)
        st_public, public_posts = admin.call("GET", "/api/blog/posts")
        public_ids = {post.get("id") for post in public_posts or []}
        log(
            st_delete == 204 and one_id not in public_ids and text_id in public_ids and multi_id in public_ids,
            "blog_eliminar_solo_un_bloque",
            f"{st_delete}",
        )

        slug = f"curso-e2e-{stamp}"
        course_payload = {
            "name": f"Curso E2E {stamp}",
            "modality": "online",
            "slug": slug,
            "short_description": "Curso visible como próximo",
            "description": "CONTENIDO PRIVADO E2E",
            "introduction": "Introducción privada",
            "syllabus": "Temario privado",
            "status": "upcoming",
            "sort_order": 3,
        }
        st_course, course = admin.call("POST", "/api/admin/courses", course_payload)
        course_id = course.get("id") if isinstance(course, dict) else None
        if st_course == 201 and course_id:
            course_ids.append(course_id)
        log(st_course == 201 and bool(course_id), "curso_crear_proximamente", f"{st_course}")

        st_dup, _ = admin.call("POST", "/api/admin/courses", course_payload)
        log(st_dup in (400, 409), "curso_slug_unico", f"{st_dup}")
        st_forbidden, _ = instr.call("POST", "/api/admin/courses", course_payload)
        log(st_forbidden == 403, "curso_permisos_admin", f"{st_forbidden}")

        st_list, courses = admin.call("GET", "/api/courses")
        visible = next((item for item in courses or [] if item.get("id") == course_id), None)
        st_hidden, hidden = admin.call("GET", f"/api/courses/{slug}")
        log(st_list == 200 and visible is None, "curso_proximamente_no_publicado", f"{st_list}")
        log(
            st_hidden == 404,
            "curso_proximamente_contenido_protegido",
            f"{st_hidden}",
        )

        section_ids = []
        for order, title in ((1, "Sección B"), (0, "Sección A")):
            st_sec, sec = admin.call(
                "POST",
                f"/api/admin/courses/{course_id}/sections",
                {"title": title, "body": f"Contenido {title}", "sort_order": order},
            )
            if st_sec == 201:
                section_ids.append(sec.get("id"))
        log(len(section_ids) == 2, "curso_anadir_y_reordenar_secciones", f"{len(section_ids)}/2")
        st_sec_edit, sec_edit = admin.call(
            "PATCH",
            f"/api/admin/courses/{course_id}/sections/{section_ids[0]}",
            {"title": "Sección B editada", "sort_order": 2},
        )
        log(st_sec_edit == 200 and sec_edit.get("sort_order") == 2, "curso_editar_seccion", f"{st_sec_edit}")
        st_sec_del, _ = admin.call(
            "DELETE", f"/api/admin/courses/{course_id}/sections/{section_ids[1]}"
        )
        log(st_sec_del == 204, "curso_eliminar_seccion", f"{st_sec_del}")

        st_publish, published = admin.call(
            "PATCH",
            f"/api/admin/courses/{course_id}",
            {"name": f"Curso E2E publicado {stamp}", "status": "published"},
        )
        st_detail, detail = admin.call("GET", f"/api/courses/{slug}")
        log(st_publish == 200 and published.get("status") == "published", "curso_editar_y_publicar", f"{st_publish}")
        log(
            st_detail == 200
            and detail.get("content_available") is True
            and detail.get("description") == "CONTENIDO PRIVADO E2E"
            and len(detail.get("sections") or []) == 1,
            "curso_ruta_dinamica_publicada",
            f"{st_detail}",
        )

        sentinel_payload = dict(course_payload)
        sentinel_payload.update({"name": f"Curso testigo {stamp}", "slug": f"testigo-{slug}"})
        st_sentinel, sentinel = admin.call("POST", "/api/admin/courses", sentinel_payload)
        sentinel_id = sentinel.get("id") if isinstance(sentinel, dict) else None
        if st_sentinel == 201 and sentinel_id:
            course_ids.append(sentinel_id)
        st_del_course, _ = admin.call("DELETE", f"/api/admin/courses/{course_id}")
        if st_del_course == 204 and course_id in course_ids:
            course_ids.remove(course_id)
        st_list, courses = admin.call("GET", "/api/courses")
        ids = {item.get("id") for item in courses or []}
        log(
            st_del_course == 204 and course_id not in ids and sentinel_id not in ids and any(item.get("id") == sentinel_id for item in (admin.call("GET", "/api/admin/courses")[1] or [])),
            "curso_eliminar_solo_seleccionado",
            f"{st_del_course}",
        )
    finally:
        for post_id in post_ids:
            admin.call("DELETE", f"/api/admin/blog/posts/{post_id}")
        for course_id in course_ids:
            admin.call("DELETE", f"/api/admin/courses/{course_id}")


async def ws_collect(url, cookie, expect_n, timeout=6):
    import websockets

    got = []
    async with websockets.connect(
        url,
        ssl=TLS_CONTEXT,
        additional_headers={"Origin": ORIGIN, "Cookie": f"uasspain_access={cookie}", "X-UASSpain-Window-Id": WINDOW_LOOKUPS.get(cookie, "")},
        open_timeout=8,
    ) as ws:
        deadline = time.time() + timeout
        while len(got) < expect_n and time.time() < deadline:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=deadline - time.time())
                got.append(msg)
            except asyncio.TimeoutError:
                break
    return got


async def ws_expect_reject(url, cookie, origin):
    import websockets

    try:
        async with websockets.connect(
            url,
            ssl=TLS_CONTEXT,
            additional_headers={
                "Origin": origin,
                "Cookie": f"uasspain_access={cookie}", "X-UASSpain-Window-Id": WINDOW_LOOKUPS.get(cookie, ""),
            },
            open_timeout=8,
        ) as ws:
            try:
                await asyncio.wait_for(ws.recv(), timeout=3)
            except Exception:
                pass
            return ws.close_code if ws.close_code else "open"
    except websockets.exceptions.ConnectionClosedError as e:
        return e.rcvd.code if e.rcvd else "closed"
    except websockets.exceptions.InvalidStatus as e:
        return f"HTTP {e.response.status_code}"
    except Exception as e:
        return type(e).__name__


async def main():
    target = urllib.parse.urlsplit(BASE)
    isolated = (
        target.hostname in {"localhost", "127.0.0.1", "host.docker.internal"}
        and target.port == 8010
    ) or (target.scheme == "http" and target.hostname == "backend-e2e" and target.port == 8000)
    if not isolated or target.username or target.password or target.path or target.query or target.fragment:
        print(
            "ABORT: E2E_BASE no apunta a una entrada de la pila aislada. "
            "Usa localhost:8010 o backend-e2e:8000 dentro de su red Docker."
        )
        sys.exit(2)

    admin = Session("admin")
    instr = Session("instructor")
    alum = Session("alumno")

    ok, me_a = login(admin, ADMIN_EMAIL, ADMIN_PASSWORD)
    log(ok, "login_admin", str(me_a.get("id") if isinstance(me_a, dict) else me_a))
    if isinstance(me_a, dict):
        st, status_data = admin.call("GET", "/api/system/status/")
        log(st == 200, "e2e_backend_status", f"{st}")
    ok, me_i = login(instr, INSTR_EMAIL, INSTR_PASSWORD)
    log(ok, "login_instructor", str(me_i.get("id") if isinstance(me_i, dict) else me_i))
    ok, me_s = login(alum, ALUM_EMAIL, ALUM_PASSWORD)
    log(ok, "login_alumno", str(me_s.get("id") if isinstance(me_s, dict) else me_s))
    if not all(
        [isinstance(me_a, dict), isinstance(me_i, dict), isinstance(me_s, dict)]
    ):
        print("ABORT: logins")
        sys.exit(1)

    id_a = me_a["id"]
    id_i = me_i["id"]
    id_s = me_s["id"]

    st, _ = admin.call("PATCH",f"/api/profiles/{id_i}/",{"roles":["admin","instructor","alumno"]})
    st2, overlapping = admin.call("GET","/api/system/status/")
    st3, _ = admin.call("PATCH",f"/api/profiles/{id_i}/",{"roles":["instructor"]})
    counts=overlapping.get("users",{})
    log(st==200 and st2==200 and st3==200 and counts.get("admin")==2 and counts.get("instructor")==1 and counts.get("alumno")==3 and counts.get("unique_active")==4,"role_counts_multirole_without_duplicate_profiles",str(st2))
    stale, _ = instr.call("GET", "/api/auth/me/")
    log(stale == 401, "role_change_revokes_existing_session", str(stale))
    ok, _ = login(instr, INSTR_EMAIL, INSTR_PASSWORD)
    log(ok, "instructor_relogin_after_role_change")
    for actor, allowed in [(admin, True), (instr, False), (alum, False)]:
        status, _ = actor.call("GET", "/api/profiles/instructores/")
        log(status == (200 if allowed else 403), "instructor_directory_admin_only_" + actor.label, str(status))
    status, _ = alum.call("GET", f"/api/profiles/{id_s}/assigned-alumnos/")
    log(status == 403, "student_cannot_use_assignment_directory", str(status))
    status, _ = admin.call("PATCH", f"/api/profiles/{id_i}/", {"roles": ["root"]})
    log(status == 400, "unknown_role_grant_denied", str(status))
    status, _ = admin.call("PATCH", f"/api/profiles/{id_i}/", {"role": "admin", "roles": ["instructor"]})
    log(status == 400, "inconsistent_primary_and_roles_denied", str(status))
    status, _ = admin.call("PATCH", f"/api/profiles/{id_s}/", {"assigned_instructor_id": str(uuid.uuid4())})
    log(status == 400, "assignment_unknown_instructor_denied", str(status))
    status, updated = admin.call("PATCH", f"/api/profiles/{id_s}/", {"assigned_instructor_id": id_i})
    log(status == 200 and updated.get("assigned_instructor_id") == id_i, "profile_assignment_persisted", str(status))
    first, overridden = admin.call("PATCH", f"/api/profiles/{id_i}/", {"login_2fa_enabled_override": False})
    second, inherited = admin.call("PATCH", f"/api/profiles/{id_i}/", {"login_2fa_enabled_override": None})
    log(first == 200 and overridden.get("login_2fa_enabled_override") is False and second == 200 and inherited.get("login_2fa_enabled_override") is None, "two_factor_override_returns_to_inheritance")
    status, scoped = instr.call("GET", "/api/profiles/?role=alumno&status=activo")
    log(status == 200 and len(scoped) == 2 and all(p.get("role") == "alumno" and p.get("status") == "activo" for p in scoped), "instructor_directory_filters_and_scope", str(status))
    st, _ = instr.call("POST","/api/mensajes-staff/",{"destinatario_id":id_i,"contenido":"self fixture"})
    log(st in (400,403),"self_chat_denied",str(st))

    # Runtime configuration and secrets are tested only in this isolated DB.
    st, smtp_view = admin.call("PUT","/api/system/smtp/",{"enabled":False,"host":"mail.example.invalid","port":587,"security":"STARTTLS","username":"fixture@example.invalid","from_email":"fixture@example.invalid","timeout_seconds":2,"password":"EphemeralSMTP_47!"})
    log(st==200 and smtp_view.get("password_configured") and "password" not in smtp_view and "ciphertext" not in smtp_view,"smtp_secret_never_serialized",str(st))
    st, smtp_view = admin.call("PUT","/api/system/smtp/",{"enabled":False,"host":"mail.example.invalid","port":587,"security":"STARTTLS","username":"fixture@example.invalid","from_email":"fixture@example.invalid","timeout_seconds":2,"password":""})
    log(st==200 and smtp_view.get("password_configured"),"smtp_partial_save_keeps_password",str(st))
    st,_=instr.call("GET","/api/system/smtp/")
    log(st==403,"smtp_admin_only",str(st))
    st,_=admin.call("PUT","/api/system/smtp/",{"enabled":True,"security":"NONE","host":"mail.example.invalid","port":587})
    log(st==400,"smtp_plaintext_rejected",str(st))
    st,_=admin.call("POST","/api/system/smtp/test/",{"recipient":"fixture@example.invalid"})
    log(st==503,"smtp_unconfigured_test_is_not_success",str(st))
    public_id="123456-fixture.apps.googleusercontent.com"
    st,_=admin.call("PUT","/api/system/google-oauth/",{"enabled":True,"client_id":public_id})
    st2, public=admin.call("GET","/api/public/oauth/google/")
    st3, challenge=admin.call("POST","/api/auth/google/challenge/",{})
    log(st==200 and st2==200 and public.get("client_id")==public_id and st3==200 and bool(challenge.get("nonce")),"google_runtime_client_and_challenge",str(st3))
    st,_=admin.call("POST","/api/auth/google/",{"id_token":"synthetic-invalid-token"})
    log(st==401,"google_runtime_does_not_bypass_token_validation",str(st))
    st,_=admin.call("PUT","/api/system/google-oauth/",{"enabled":False,"client_id":""})
    st2,public=admin.call("GET","/api/public/oauth/google/")
    log(st==200 and st2==200 and not public.get("configured") and public.get("client_id") is None,"google_disabled_overrides_runtime",str(st))
    st,_=admin.call("PUT","/api/system/google-oauth/",{"enabled":True,"client_id":"invalid"})
    log(st==400,"google_invalid_client_rejected",str(st))
    st,real_status=admin.call("GET","/api/system/status/")
    log(st==200 and real_status.get("database",{}).get("connected") and real_status.get("redis",{}).get("connected") and real_status.get("users",{}).get("admin")==1,"system_status_real_contract",str(st))

    run_content_e2e(admin, instr)
    if os.environ.get("E2E_CONTENT_ONLY") == "1":
        fails = [line for line in OUT if line.startswith("FAIL")]
        print(f"\n{len(OUT) - len(fails)}/{len(OUT)} CONTENT E2E PASS")
        sys.exit(1 if fails else 0)

    st, data = admin.call(
        "POST", f"/api/profiles/{id_i}/assign-alumnos/", {"student_ids": [id_s]}
    )
    log(st in (200, 201), "assign_alumno_to_instructor", f"{st} {data}"[:200])

    st, ex = instr.call(
        "POST",
        "/api/examenes/",
        {
            "nombre": f"E2E Examen {int(time.time())}",
            "categoria": "A1/A3",
            "descripcion": "E2E controlado",
            "activo": True,
            "num_preguntas": 3,
        },
    )
    log(st == 201, "exam_create", f"{st}"[:200])
    if not (isinstance(ex, dict) and ex.get("id")):
        print("ABORT: exam_create")
        sys.exit(1)
    ex_id = ex["id"]

    preguntas = [
        ("Q1 enunciado", "op1", "op2", "op3", "op4", "a", 1),
        ("Q2 enunciado", "op1", "op2", "op3", "op4", "b", 2),
        ("Q3 enunciado", "op1", "op2", "op3", "op4", "c", 3),
    ]
    pids = []
    all_p_ok = True
    for enun, a, b, c, d, corr, orden in preguntas:
        st, p = instr.call(
            "POST",
            "/api/preguntas/",
            {
                "examen_id": ex_id,
                "enunciado": enun,
                "opcion_a": a,
                "opcion_b": b,
                "opcion_c": c,
                "opcion_d": d,
                "respuesta_correcta": corr,
                "orden": orden,
            },
        )
        all_p_ok = all_p_ok and st == 201
        pids.append(p.get("id"))
    log(all_p_ok, "preguntas_create", f"{len([x for x in pids if x])}/3")

    st, lista = alum.call("GET", "/api/examenes/")
    ids_visible = [
        x["id"]
        for x in (lista.get("results") if isinstance(lista, dict) else lista or [])
    ]
    log(st == 200 and ex_id in ids_visible, "alumno_ve_examen", f"{st}")

    st, p1 = alum.call("GET", f"/api/preguntas/?examen_id={ex_id}")
    st2, p2 = instr.call("GET", f"/api/preguntas/?examen_id={ex_id}")
    items1 = p1.get("results") if isinstance(p1, dict) else p1
    items2 = p2.get("results") if isinstance(p2, dict) else p2
    no_secret = all("respuesta_correcta" not in it for it in items1)
    order1 = [it["id"] for it in items1]
    order2 = [it["id"] for it in items2]
    st3, p3 = instr.call("GET", f"/api/preguntas/?examen_id={ex_id}")
    items3 = p3.get("results") if isinstance(p3, dict) else p3
    order3 = [it["id"] for it in items3]
    log(st == 200 and no_secret, "alumno_preguntas_sin_clave", f"{st}")
    log(order1 == order2 == order3, "orden_estable_sin_aleatorizacion", f"{order1}")

    respuestas = {pids[0]: "a", pids[1]: "d"}
    st, attempt = alum.call("POST", f"/api/examenes/{ex_id}/intentos/", {"modalidad": "tiempo"})
    attempt_id = attempt.get("id")
    log(st == 200 and len(attempt.get("preguntas", [])) == 3
        and all("respuesta_correcta" not in q for q in attempt.get("preguntas", [])),
        "intento_snapshot_sin_claves", str(st))
    st, res = alum.call(
        "POST",
        "/api/resultados-examen/",
        {
            "examen_id": ex_id,
            "attempt_id": attempt_id,
            "respuestas": respuestas,
            "tiempo_empleado": 999999,
            "aciertos": 99,
            "nota": 99,
            "aprobado": True,
        },
    )
    esperado_aciertos, esperado_errores = 1, 1
    esperado_nota, esperado_pct = 3.3, 33.3
    ok = (
        st == 201
        and res.get("aciertos") == esperado_aciertos
        and res.get("errores") == esperado_errores
        and float(res.get("nota", 0)) == esperado_nota
        and float(res.get("porcentaje", 0)) == esperado_pct
        and res.get("aprobado") is False
    )
    log(
        ok,
        "autocorreccion_esperada==obtenida",
        f"aciertos={res.get('aciertos')} errores={res.get('errores')} "
        f"nota={res.get('nota')} pct={res.get('porcentaje')}",
    )
    det = res.get("detalle_revision") or {}
    log(len(det) == 3, "detalle_revision_3_items", f"{len(det)}")
    res_id = res.get("id")
    log(res.get("tiempo_empleado", 999999) < 60, "tiempo_del_servidor_no_del_payload")
    st, replay = alum.call("POST", "/api/resultados-examen/", {
        "examen_id": ex_id, "attempt_id": attempt_id, "respuestas": {pids[0]: "d"},
    })
    log(st == 201 and replay.get("id") == res_id and replay.get("aciertos") == 1,
        "envio_repetido_idempotente", str(st))

    st, free_attempt = alum.call("POST", f"/api/examenes/{ex_id}/intentos/", {"modalidad": "libre"})
    free_id = free_attempt.get("id")
    saved, _ = alum.call("PUT", f"/api/intentos-examen/{free_id}/", {"respuestas": respuestas})
    st, resumed = alum.call("POST", f"/api/examenes/{ex_id}/intentos/", {"modalidad": "libre"})
    log(saved == 204 and st == 200 and resumed.get("id") == free_id
        and resumed.get("respuestas") == respuestas and resumed.get("expires_at") is None,
        "intento_reanuda_respuestas_y_reloj")
    st, _ = alum.call("PUT", f"/api/intentos-examen/{free_id}/", {"respuestas": {str(uuid.uuid4()): "a"}})
    log(st == 400, "intento_rechaza_preguntas_ajenas", str(st))
    st, _ = alum.call("PUT", f"/api/intentos-examen/{free_id}/", {"respuestas": {pids[0]: ["a"]}})
    log(st == 400, "intento_rechaza_respuestas_no_tipadas", str(st))
    st, _ = instr.call("PUT", f"/api/intentos-examen/{free_id}/", {"respuestas": respuestas})
    log(st == 403, "instructor_no_responde_por_alumno", str(st))
    st, sampled_exam = instr.call("POST", "/api/examenes/", {
        "nombre": "E2E selección", "categoria": "A1/A3", "num_preguntas": 2, "activo": True
    })
    sampled_ids = []
    for number in range(3):
        _, question = instr.call("POST", "/api/preguntas/", {
            "examen_id": sampled_exam["id"], "enunciado": f"Banco {number}",
            "opcion_a": "A", "opcion_b": "B", "opcion_c": "C", "opcion_d": "D", "respuesta_correcta": "a", "orden": number
        })
        sampled_ids.append(question["id"])
    st, sampled = alum.call("POST", f"/api/examenes/{sampled_exam['id']}/intentos/", {"modalidad": "libre"})
    selected_ids = [question["id"] for question in sampled.get("preguntas", [])]
    log(st == 200 and len(selected_ids) == len(set(selected_ids)) == 2
        and set(selected_ids).issubset(sampled_ids), "seleccion_respeta_numero_sin_duplicados")
    st, _ = instr.call("DELETE", f"/api/examenes/{sampled_exam['id']}/")
    log(st == 204, "borrado_examen_con_preguntas_e_intento", str(st))
    st, _ = alum.call("POST", f"/api/examenes/{ex_id}/intentos/", {"modalidad": "inventada"})
    log(st == 400, "intento_modalidad_cerrada", str(st))
    st, _ = alum.call("POST", "/api/resultados-examen/", {
        "examen_id": ex_id, "respuestas": respuestas,
    })
    log(st == 400, "examen_no_admite_envio_sin_intento", str(st))
    st, _ = alum.call("POST", "/api/resultados-examen/", {
        "examen_id": ex_id, "attempt_id": free_id, "modalidad": "tiempo", "respuestas": respuestas,
    })
    log(st == 400, "examen_no_admite_cambio_modalidad", str(st))

    inactive, _ = instr.call("PATCH", f"/api/examenes/{ex_id}/", {"activo": False})
    st, hidden = alum.call("GET", "/api/examenes/")
    denied, _ = alum.call("POST", f"/api/examenes/{ex_id}/intentos/", {"modalidad": "libre"})
    log(inactive == 200 and st == 200 and ex_id not in {e["id"] for e in hidden}
        and denied == 404, "examen_inactivo_denegado_en_servidor")
    instr.call("PATCH", f"/api/examenes/{ex_id}/", {"activo": True})

    st, advanced = instr.call("POST", "/api/examenes/", {
        "nombre": "E2E A2 prerequisite", "categoria": "A2", "activo": True,
    })
    advanced_id = advanced.get("id")
    denied, _ = alum.call("POST", f"/api/examenes/{advanced_id}/intentos/", {"modalidad": "libre"})
    log(st == 201 and denied == 403, "prerrequisito_categoria_validado_por_servidor")
    instr.call("DELETE", f"/api/examenes/{advanced_id}/")

    st, again = alum.call("GET", f"/api/resultados-examen/{res_id}/")
    ok = st == 200 and float(again.get("nota", 0)) == esperado_nota
    log(ok, "persistencia_tras_recarga", f'{st} nota={again.get("nota")}')

    st_i, ri = instr.call("GET", "/api/resultados-examen/")
    items_i = ri.get("results") if isinstance(ri, dict) else ri
    st_a, ra = admin.call("GET", "/api/resultados-examen/")
    items_a = ra.get("results") if isinstance(ra, dict) else ra
    st_s, rs = alum.call("GET", "/api/resultados-examen/")
    items_s = rs.get("results") if isinstance(rs, dict) else rs
    ids_i = {x["id"] for x in items_i or []}
    ids_a = {x["id"] for x in items_a or []}
    ids_s = {x["id"] for x in items_s or []}
    log(st_i == 200 and res_id in ids_i, "instructor_ve_resultado", f"{st_i}")
    log(st_a == 200 and res_id in ids_a, "admin_ve_resultado", f"{st_a}")
    log(
        st_s == 200 and res_id in ids_s and len(ids_s) >= 1,
        "alumno_solo_los_suyos",
        f"{st_s} n={len(ids_s)}",
    )

    st, bad = alum.call(
        "POST", "/api/resultados-examen/", {"examen_id": ex_id, "respuestas": ["a"]}
    )
    log(st == 400, "respuestas_formato_invalido_400", f"{st}")

    st, blk = instr.call(
        "POST",
        "/api/bloqueos-examen/",
        {
            "alumno_id": id_s,
            "examen_id": ex_id,
            "bloqueado": True,
            "categoria": "A1/A3",
            "motivo": "E2E",
        },
    )
    log(st == 201, "bloqueo_create", f"{st}")
    st, lista2 = alum.call("GET", "/api/examenes/")
    ids2 = [
        x["id"]
        for x in (lista2.get("results") if isinstance(lista2, dict) else lista2 or [])
    ]
    log(st == 200 and ex_id not in ids2, "bloqueo_oculta_examen_alumno", f"{st}")
    st, denied = alum.call(
        "POST", "/api/resultados-examen/", {"examen_id": ex_id, "attempt_id": free_id, "respuestas": {}}
    )
    log(st == 400, "bloqueo_impide_envio", f"{st}")
    blk_id = blk["id"]
    st, unblk = instr.call(
        "PATCH", f"/api/bloqueos-examen/{blk_id}/", {"bloqueado": False}
    )
    log(st in (200, 204), "desbloqueo", f"{st}")
    st, lista3 = alum.call("GET", "/api/examenes/")
    ids3 = [
        x["id"]
        for x in (lista3.get("results") if isinstance(lista3, dict) else lista3 or [])
    ]
    log(st == 200 and ex_id in ids3, "examen_visible_tras_desbloqueo", f"{st}")

    import tempfile

    tmp_pdf = os.path.join(tempfile.gettempdir(), "e2e_controlled.pdf")
    make_controlled_pdf(tmp_pdf)
    pdf_bytes = open(tmp_pdf, "rb").read()
    body, ctype = multipart(pdf_bytes, "e2e_controlled.pdf", "application/pdf")
    st, up = instr.call("POST", "/api/uploads/", raw_body=body, content_type=ctype)
    extra = ""
    if st != 201 and not (isinstance(up, dict) and up.get("file_url")):
        extra = f" {up}"[:150]
    log(st == 201, "upload_pdf", f"{st}{extra}")
    if not (isinstance(up, dict) and up.get("file_url")):
        print("ABORT: upload_pdf")
        sys.exit(1)
    file_url = up.get("file_url")
    st, imp = instr.call(
        "POST",
        "/api/examenes/importar-pdf/",
        {
            "file_url": file_url,
            "categoria": "A1/A3",
            "metadata": {
                "original_name": "e2e_controlled.pdf",
                "content_type": "application/pdf",
                "path": up.get("path"),
                "sha256": up.get("sha256"),
                "size": up.get("size"),
            },
        },
    )
    ok = (
        st == 200
        and isinstance(imp, dict)
        and imp.get("total_validas") == 3
        and imp.get("total_errores") == 1
    )
    log(
        ok,
        "import_pdf_rechaza_respuesta_ambigua",
        f"{st} validas={imp.get('total_validas') if isinstance(imp, dict) else '?'} "
        f"errores={imp.get('total_errores') if isinstance(imp, dict) else '?'}",
    )

    st, m1 = instr.call(
        "POST",
        "/api/mensajes/",
        {"alumno_id": id_s, "contenido": "E2E mensaje inicial"},
    )
    log(st == 201, "mensaje_inicial_instructor", f"{st}")
    st, _ = alum.call("PATCH", f"/api/mensajes/{m1['id']}/", {"leido_alumno": True})
    log(st == 200, "alumno_marca_mensaje_instructor_leido", str(st))
    st, _ = alum.call("PATCH", f"/api/mensajes/{m1['id']}/", {"contenido": "contenido adulterado"})
    log(st == 403, "alumno_no_edita_mensaje_instructor", str(st))
    other_student = Session("other_student")
    ok, _ = login(other_student, "segundo.e2e@test.local", "E2eSecond_2026!")
    st, _ = other_student.call("GET", f"/api/mensajes/{m1['id']}/")
    log(ok and st == 403, "idor_mensaje_ajeno_denegado", str(st))
    st, _ = other_student.call("PUT", f"/api/intentos-examen/{free_id}/", {"respuestas": {}})
    log(st == 404, "idor_intento_ajeno_denegado", str(st))

    room = id_s
    url = f"{WS_BASE}/ws/chat/{room}/"
    import websockets

    async def both_flow():
        recv_s, recv_i = [], []
        async with (
            websockets.connect(
                url,
                ssl=TLS_CONTEXT,
                additional_headers={
                    "Origin": ORIGIN,
                    "Cookie": f"uasspain_access={alum.access_cookie()}", "X-UASSpain-Window-Id": alum.window_id,
                },
                open_timeout=8,
            ) as wsS,
            websockets.connect(
                url,
                ssl=TLS_CONTEXT,
                additional_headers={
                    "Origin": ORIGIN,
                    "Cookie": f"uasspain_access={instr.access_cookie()}", "X-UASSpain-Window-Id": instr.window_id,
                },
                open_timeout=8,
            ) as wsI,
        ):
            await asyncio.sleep(0.3)
            st1, _ = instr.call(
                "POST", "/api/mensajes/", {"alumno_id": id_s, "contenido": "E2E i to a"}
            )
            try:
                recv_s.append(await asyncio.wait_for(wsS.recv(), timeout=5))
            except Exception as e:
                recv_s.append(f"ERR {e}")
            st2, _ = alum.call("POST", "/api/mensajes/", {"contenido": "E2E a to i"})
            try:
                recv_i.append(await asyncio.wait_for(wsI.recv(), timeout=5))
            except Exception as e:
                recv_i.append(f"ERR {e}")
            return st1, st2, recv_s, recv_i

    st1, st2, recv_s, recv_i = await both_flow()
    ok_s = any("E2E i to a" in str(m) for m in recv_s)
    ok_i = any("E2E a to i" in str(m) for m in recv_i)
    log(
        st1 == 201 and ok_s,
        "ws_instructor_envia_alumno_recibe",
        f"{st1} got={len(recv_s)}",
    )
    log(
        st2 == 201 and ok_i,
        "ws_alumno_envia_instructor_recibe",
        f"{st2} got={len(recv_i)}",
    )

    reject = await ws_expect_reject(url, instr.access_cookie(), "http://evil.example")
    log(
        str(reject) in ("4403", "1008", "closed", "ConnectionClosedError", "HTTP 403")
        or reject == 4403,
        "ws_origen_extranjero_rechazado",
        str(reject),
    )

    st, hist_i = instr.call(
        "GET", f"/api/mensajes/?alumno_id={id_s}&ordering=created_date"
    )
    items_h = hist_i.get("results") if isinstance(hist_i, dict) else hist_i
    contents = [x.get("contenido") for x in items_h or []]
    ok = st == 200 and "E2E i to a" in contents and "E2E a to i" in contents
    log(ok, "historial_chat_bidireccional", f"{st} n={len(contents)}")

    st, sm = admin.call(
        "POST",
        "/api/mensajes-staff/",
        {"destinatario_id": id_i, "contenido": "E2E staff"},
    )
    log(st == 201, "staff_mensaje_admin_a_instructor", f"{st}")
    st, clist = instr.call("GET", "/api/mensajes-staff/contacts/")
    cids = [
        x["id"]
        for x in (clist if isinstance(clist, list) else clist.get("results", []))
    ]
    log(st == 200 and id_a in cids, "staff_contacts_incluye_admin", f"{st}")
    st, instructor_logs = instr.call("GET", "/api/registros-conexion/")
    log(st == 200 and all(row.get("profile_id") != id_a for row in instructor_logs),
        "instructor_no_ve_logs_administrador")
    st, admin_logs = admin.call("GET", "/api/registros-conexion/")
    admin_log = next((row for row in admin_logs if row.get("profile_id") == id_a), None)
    if admin_log:
        st, _ = instr.call("GET", f"/api/registros-conexion/{admin_log['id']}/")
    log(admin_log is not None and st == 404, "idor_log_admin_denegado_al_instructor", str(st))

    staff_room = "staff-" + "-".join(sorted([id_a, id_i]))
    staff_url = f"{WS_BASE}/ws/chat/{staff_room}/"
    async with websockets.connect(staff_url, ssl=TLS_CONTEXT, additional_headers={
        "Origin": ORIGIN, "Cookie": f"uasspain_access={instr.access_cookie()}", "X-UASSpain-Window-Id": instr.window_id
    }, open_timeout=8) as staff_socket:
        st, _ = admin.call("POST", "/api/mensajes-staff/", {
            "destinatario_id": id_i, "contenido": "Staff realtime E2E"
        })
        incoming = json.loads(await asyncio.wait_for(staff_socket.recv(), timeout=5))
        log(st == 201 and incoming.get("content") == "Staff realtime E2E",
            "staff_ws_sala_compartida_bidireccional")
    rejection = await ws_expect_reject(staff_url, alum.access_cookie(), ORIGIN)
    log(str(rejection) == "HTTP 403", "staff_sala_ajena_denegada", str(rejection))

    anonymous = Session("anonymous")
    st, _ = anonymous.call("POST", "/api/auth/resend-otp/", {"email": ALUM_EMAIL})
    verified_status, _ = alum.call("GET", "/api/auth/me/")
    log(st == 200 and verified_status == 200, "resend_otp_no_revoca_cuenta_verificada")
    st, _ = anonymous.call("POST", "/api/auth/resend-otp/", {"email": "missing@test.local"})
    log(st == 200, "resend_otp_no_enumera_usuarios")

    st, call_one = instr.call("POST", "/api/videollamadas/", {
        "alumno_id": id_s, "estado": "activa", "room_id": "forged-public-room"
    })
    st2, second_me = other_student.call("GET", "/api/auth/me/")
    st2, call_two = instr.call("POST", "/api/videollamadas/", {
        "alumno_id": second_me["id"], "estado": "activa"
    })
    log(st == 201 and st2 == 201 and call_one["room_id"] == call_two["room_id"]
        and call_one["room_id"] != "forged-public-room", "videollamada_grupal_sala_servidor")
    st, _ = other_student.call("GET", f"/api/videollamadas/{call_one['id']}/")
    log(st == 403, "videollamada_idor_denegada", str(st))
    st, _ = instr.call("PATCH", f"/api/videollamadas/{call_one['id']}/", {"estado": "finalizada"})
    st2, active_calls = instr.call("GET", "/api/videollamadas/?estado=activa")
    log(st == 200 and st2 == 200 and active_calls == [], "instructor_cierra_toda_sala")
    st, _ = alum.call("PATCH", f"/api/videollamadas/{call_one['id']}/", {"estado": "activa"})
    log(st == 400, "alumno_no_reabre_sala_finalizada", str(st))

    st, perm = admin.call(
        "POST",
        "/api/auth/login/",
        {"email": ADMIN_EMAIL, "password": "WrongPassword_e2e!"},
    )
    log(st in (400, 401), "login_password_invalida_rechazada", f"{st}")
    for _ in range(10):
        anonymous.call("POST", "/api/auth/login/", {"email": "rate-fixture@test.local", "password": "Incorrecta"})  # pragma: allowlist secret - invalid isolated fixture
    st, _ = anonymous.call("POST", "/api/auth/login/", {"email": "rate-fixture@test.local", "password": "Incorrecta"})  # pragma: allowlist secret - invalid isolated fixture
    log(st == 429, "limite_login_no_se_desactiva_en_e2e", str(st))

    # ─── Backups §8/§9: origen local, auditoría y control ───────
    st, origins = admin.call("GET", "/api/backups/origins/")
    log(
        st == 200
        and origins.get("origin") == "local"
        and isinstance(origins.get("available"), list),
        "e2e_origins_local",
        f"{st}",
    )

    st, created = admin.call(
        "POST", "/api/backups/create/", {"type": "full", "encrypt": True}
    )
    job = created.get("job") if isinstance(created, dict) else None
    local_base_id = job.get("id") if job else None
    log(
        st == 200 and bool(job) and job.get("status") in ("completed", "partial"),
        "e2e_backup_full_local_create",
        f"{st} {job.get('status') if job else created}",
    )

    st, hist = admin.call("GET", "/api/backups/history/")
    items = hist if isinstance(hist, list) else (hist.get("results") or [])
    audit_job = next((x for x in items if x.get("initiated_by")), None)
    log(
        st == 200
        and audit_job is not None
        and audit_job.get("initiated_by") == ADMIN_EMAIL,
        "e2e_backup_audit_initiated_by",
        f"{st} {audit_job.get('initiated_by') if audit_job else ''}",
    )

    st, deny = admin.call("POST", "/api/backups/restore/", {"origin": "local"})
    log(st == 400, "e2e_restore_requiere_confirmacion", f"{st}")

    # Destinos externos §9/§10: config independiente + host estricto
    st, srv = admin.call(
        "POST",
        "/api/backups/servers/",
        {
            "name": "E2E ext",
            "role": "local",
            "ip_address": "172.30.99.10",
            "transfer_protocol": "sftp",
            "sftp_host": "sftp-e2e",
            "is_active": False,
        },
    )
    srv_id = srv.get("id") if isinstance(srv, dict) else None
    log(st == 201 and bool(srv_id), "e2e_server_externo_creado", f"{st}")
    st, put = admin.call(
        "PUT", f"/api/backups/servers/{srv_id}/", {"sftp_host": "nuevo-host.e2e"}
    )
    log(
        st == 200 and put.get("sftp_host") == "nuevo-host.e2e",
        "e2e_server_host_guardado",
        f"{st} {put.get('sftp_host') if isinstance(put, dict) else ''}",
    )
    st, bad = admin.call(
        "PUT", f"/api/backups/servers/{srv_id}/", {"sftp_host": "host; rm -rf /"}
    )
    log(st == 400, "e2e_server_host_inyectado_rechazado", f"{st}")

    # ─── §12 en copia aislada: full local, externos 1/2, checksum,
    #     historial auditado y restauraciones por origen ──────────
    st, _ = admin.call("POST", "/api/backups/servers/", {"name":"Duplicate", "role":"local", "ip_address":"127.0.0.1", "is_active":False})
    log(st==409,"backup_slot_duplicado_denegado",str(st))
    admin.call("DELETE", f"/api/backups/servers/{srv_id}/")
    st, local_destination=admin.call("POST","/api/backups/servers/",{"name":"E2E local","role":"local","ip_address":"127.0.0.1","transfer_protocol":"copy","smb_share":"/app/backups/destination-local","is_active":True})
    log(st==201,"backup_destino_local_creado",str(st))
    key_path = "/app/backup_keys/backup_sftp_ed25519"
    kh_path = "/app/backup_keys/known_hosts"

    def create_ext(name, ip, host, user, offsite):
        stx, data = admin.call(
            "POST",
            "/api/backups/servers/",
            {
                "name": name,
                "role": "external_2" if offsite else "external_1",
                "ip_address": ip,
                "transfer_protocol": "sftp",
                "sftp_host": host,
                "sftp_user": user,
                "sftp_port": 2222,
                "sftp_remote_path": "/backups",
                "sftp_key_path": key_path,
                "sftp_known_hosts": kh_path,
                "is_active": True,
                "is_offsite": offsite,
            },
        )
        return stx, (data.get("id") if isinstance(data, dict) else None)

    st_e1, ext1x = create_ext(
        "E2E ext1", "172.30.99.11", "sftp-ext1-e2e", "backupsftp", False
    )
    st_e2, ext2x = create_ext(
        "E2E ext2", "172.30.99.12", "sftp-ext2-e2e", "offsite", True
    )
    log(
        st_e1 == 201 and st_e2 == 201 and bool(ext1x) and bool(ext2x),
        "e2e_destinos_externos_creados",
        f"{st_e1}/{st_e2}",
    )

    st, created = call_post_retry(
        admin, "/api/backups/create/", {"type": "full", "encrypt": True}, timeout=180
    )
    full = created.get("job") if isinstance(created, dict) else None
    full_id = full.get("id") if isinstance(full, dict) else None
    log(
        st == 200 and bool(full) and full.get("status") == "completed",
        "e2e_backup_full_completado",
        f"{st} {full.get('status') if full else created}",
    )
    log(
        bool(full)
        and bool(full.get("manifest_checksum"))
        and full.get("chain_index") == 0
        and full.get("parent_backup_id") is None,
        "e2e_backup_manifest_full",
        str(full.get("manifest_checksum", ""))[:24] if full else "missing",
    )
    st, checked = admin.call(
        "POST", "/api/backups/verify/", {"job_id": full_id}, timeout=60
    )
    log(
        st == 200 and checked.get("valid") is True and not checked.get("errors"),
        "e2e_backup_verify_manifest_y_payload",
        f"{st} {checked.get('errors') if isinstance(checked, dict) else checked}",
    )

    ext_origins = {}
    for label, sid in (("ext1", ext1x), ("ext2", ext2x)):
        st, org = admin.call("GET", f"/api/backups/origins/?origin={sid}", timeout=60)
        avail = org.get("available") if isinstance(org, dict) else None
        ext_origins[label] = (avail or [])[0] if avail else None
        log(
            st == 200
            and isinstance(org, dict)
            and org.get("ok")
            and len(avail or []) >= 1
            and bool((avail or [{}])[0].get("checksum")),
            f"e2e_origins_{label}_con_checksum",
            f"{st} n={len(avail or [])}",
        )

    st, org1 = admin.call("GET", f"/api/backups/origins/?origin={ext1x}", timeout=60)
    avail1 = org1.get("available") if isinstance(org1, dict) else None
    fname1 = next(
        (f.get("filename") for f in (avail1 or []) if "_full_" in f.get("filename", "")),
        None,
    )
    st, res1 = do_restore(
        admin,
        {"origin": ext1x, "filename": fname1, "confirmed": True},
    )
    log(
        st == 200 and res1.get("checksum_verified") is True,
        "e2e_restore_desde_ext1",
        f"{st} {res1.get('detail') or res1.get('error')}",
    )

    st, hist = admin.call("GET", "/api/backups/history/")
    items = hist if isinstance(hist, list) else (hist.get("results") or [])
    has_full = any(
        x.get("job_type") == "full" and x.get("initiated_by") == ADMIN_EMAIL
        for x in items
    )
    log(st == 200 and has_full, "e2e_historial_full_auditado", f"{st}")

    st, res2 = do_restore(
        admin,
        {"origin": "local", "job_id": full_id, "confirmed": True},
    )
    log(
        st == 200 and res2.get("checksum_verified") is True,
        "e2e_restore_local_full",
        f"{st} {res2.get('detail') or res2.get('error')}",
    )

    st, hist = admin.call("GET", "/api/backups/history/")
    items = hist if isinstance(hist, list) else (hist.get("results") or [])
    restored = next((x for x in items if x.get("id") == full_id), None)
    log(
        st == 200
        and restored is not None
        and restored.get("restored_by") == ADMIN_EMAIL,
        "e2e_auditoria_restauracion",
        f"{st} {restored.get('restored_by') if restored else ''}",
    )

    # ─── §12 restantes en copia aislada ──────────────────────────
    # restauración desde externo 2
    st, org2 = admin.call("GET", f"/api/backups/origins/?origin={ext2x}", timeout=60)
    avail2 = org2.get("available") if isinstance(org2, dict) else None
    fname2 = next(
        (
            f.get("filename")
            for f in (avail2 or [])
            if "_full_" in f.get("filename", "")
        ),
        None,
    )
    st, res3 = do_restore(
        admin, {"origin": ext2x, "filename": fname2, "confirmed": True}
    )
    log(
        st == 200 and res3.get("checksum_verified") is True,
        "e2e_restore_desde_ext2",
        f"{st} {res3.get('detail') or res3.get('error')}",
    )

    # credenciales inválidas: usuario inexistente en el servidor SFTP
    st_b, _ = admin.call("PUT",f"/api/backups/servers/{ext1x}/",{"sftp_user":"nosuchuser"})
    st, tc = admin.call("POST","/api/backups/test-connection/",{"server_id":ext1x},timeout=60)
    log(st_b==200 and st==200 and tc.get("ok") is False,"e2e_credenciales_invalidas_rechazadas",str(st))
    admin.call("PUT",f"/api/backups/servers/{ext1x}/",{"sftp_user":"backupsftp"})

    bad_host=ext1x
    st_h,_=admin.call("PUT",f"/api/backups/servers/{ext1x}/",{"sftp_host":"no-such-host.e2e"})
    st, fl = call_post_retry(
        admin,
        "/api/backups/create/",
        {"type": "incremental", "encrypt": True},
        timeout=180,
    )
    fljob = fl.get("job") if isinstance(fl, dict) else None
    log(
        st_h == 200
        and st == 200
        and fljob is not None
        and fljob.get("status") == "partial",
        "e2e_backup_fallo_conexion",
        f"{st} {fljob.get('status') if fljob else fl}",
    )
    st_pu, _pu = admin.call(
        "PUT", f"/api/backups/servers/{bad_host}/", {"sftp_host": "sftp-ext1-e2e"}
    )
    st, rec = call_post_retry(
        admin,
        "/api/backups/create/",
        {"type": "incremental", "encrypt": True},
        timeout=180,
    )
    recjob = rec.get("job") if isinstance(rec, dict) else None
    rec_id = recjob.get("id") if recjob else None
    log(
        st_pu == 200
        and st == 200
        and recjob is not None
        and recjob.get("status") == "completed",
        "e2e_recuperacion_tras_fallo",
        f"{st} {recjob.get('status') if recjob else rec}",
    )
    log(
        recjob is not None
        and recjob.get("job_type") == "incremental"
        and recjob.get("chain_index", 0) > 0
        and bool(recjob.get("parent_backup_id"))
        and bool(recjob.get("base_full_id"))
        and bool(recjob.get("manifest_checksum")),
        "e2e_cadena_incremental_manifest",
        f"index={recjob.get('chain_index') if recjob else None}",
    )
    st_del, _ = admin.call(
        "DELETE", f"/api/backups/{full_id}/", {"confirmed": True}
    )
    log(
        st_del == 400,
        "e2e_full_con_dependencias_no_se_elimina",
        f"{st_del}",
    )

    # Un archivo remoto no catalogado se rechaza antes de leerlo. La alteración
    # de payload catalogado se cubre en el test Rust `corrupted_backup_payload_is_rejected`.
    st, res4 = do_restore(
        admin,
        {
            "origin": ext1x,
            "filename": "uasspain_full_20200101_000000.sql.gz.enc",
            "confirmed": True,
        },
    )
    log(
        st == 404,
        "e2e_backup_remoto_no_catalogado_rechazado",
        f"{st}",
    )

    # restauración local incremental
    st, res5 = do_restore(
        admin,
        {"origin": "local", "job_id": rec_id, "confirmed": True},
    )
    log(
        st == 200 and res5.get("checksum_verified") is True,
        "e2e_restore_local_incremental",
        f"{st} {res5.get('detail') or res5.get('error')}",
    )

    st, me = admin.call("GET", "/api/auth/me/")
    log(st == 200, "e2e_post_restore_auth_ok", f"{st}")

    print("\n==== E2E SUMMARY ====")
    fails = [line for line in OUT if line.startswith("FAIL")]
    print(f"{len(OUT) - len(fails)}/{len(OUT)} PASS")
    for f in fails:
        print(f)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    asyncio.run(main())

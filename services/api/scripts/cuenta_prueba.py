"""Crea (o repone) la cuenta de atleta de prueba, con un bloque ya cargado.

    python -m scripts.cuenta_prueba                                          # produccion
    $env:API = "http://127.0.0.1:8000/api/v1"; python -m scripts.cuenta_prueba    # API local

Las credenciales del atleta estan aqui a proposito: es una cuenta para probar la
app y solo ve sus propios datos. Su coach, en cambio, recibe una contrasena al
azar que no se guarda en ningun sitio: un coach con contrasena publica podria
asomarse a datos de otros, asi que nadie entra con el.

Pide por teclado el email y la contrasena del administrador. Da de alta al coach
y al atleta (o les repone la contrasena si ya existen), crea el bloque con sus
semanas y registra unas sesiones para que haya historial. Si el atleta ya tiene
bloque no crea otro: se puede correr las veces que haga falta.
"""

from __future__ import annotations

import asyncio
import getpass
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import httpx

ATLETA_EMAIL = "atleta.prueba@example.com"
ATLETA_PASSWORD = "AtletaPrueba2026"
ATLETA_NOMBRE = "Atleta Prueba"

COACH_EMAIL = "coach.prueba@example.com"
COACH_NOMBRE = "Coach Prueba"

API = os.environ.get("API", "https://the-cage-api.fly.dev/api/v1")

FEEDBACK = {
    "joint": "Ninguno",
    "soreness": "Se fue justo a tiempo",
    "pump": "Moderado",
    "volume": "Justo",
}


async def login(c: httpx.AsyncClient, email: str, password: str) -> dict[str, str]:
    """Respeta el limite de 5 logins por minuto: si salta, espera y reintenta."""
    for _ in range(15):
        r = await c.post("/auth/login", json={"email": email, "password": password})
        if r.status_code != 429:
            r.raise_for_status()
            return {"Authorization": f"Bearer {r.json()['accessToken']}"}
        await asyncio.sleep(5)
    raise SystemExit("El login sigue limitado; prueba en un minuto.")


async def asegurar(c, admin, usuarios, alta, email, password) -> tuple[str, dict[str, str]]:
    """Alta (o reposicion) y cambio de la contrasena provisional. Devuelve (id, cabeceras)."""
    existente = next((u for u in usuarios if u["email"] == email), None)
    if existente is None:
        r = await c.post(alta[0], json=alta[1], headers=admin)
    else:
        r = await c.post(f"/admin/users/{existente['id']}/password", headers=admin)
    r.raise_for_status()
    datos = r.json()
    temporal = datos["temporaryPassword"]
    h = await login(c, email, temporal)
    r = await c.post(
        "/auth/change-password",
        headers=h,
        json={"currentPassword": temporal, "newPassword": password},
    )
    r.raise_for_status()
    return datos["user"]["id"], h


def basico(cat, nombre, dia, semanas, backoff=False):
    """Carga en todas las semanas: (kg, sets, reps). La ultima es el deload."""
    weeks = []
    for n, (kg, sets, reps) in enumerate(semanas, start=1):
        w = {"weekNumber": n, "loadKg": kg, "sets": sets, "repLo": reps, "repHi": reps}
        if backoff and n < len(semanas):
            w |= {"backoffSets": 2, "backoffReps": reps + 2, "backoffLoadKg": kg - 15}
        weeks.append(w)
    kg, sets, reps = semanas[0]
    return {
        "catalogId": cat[nombre], "dayNumber": dia, "repLo": reps, "repHi": reps,
        "targetRir": 2, "loadIncrementKg": 2.5, "startingLoadKg": kg,
        "startingReps": reps, "startingSets": sets, "weeks": weeks,
    }  # fmt: skip


def accesorio(cat, nombre, dia, kg, lo, hi, inc):
    return {
        "catalogId": cat[nombre], "dayNumber": dia, "repLo": lo, "repHi": hi,
        "targetRir": 2, "loadIncrementKg": inc, "startingLoadKg": kg,
        "startingReps": lo, "startingSets": 3,
    }  # fmt: skip


async def entrenar(c, coach, atleta, meso_id, semana, dia, hace_dias):
    """El coach genera la sesion y el atleta la hace, da feedback y la cierra."""
    r = await c.post(
        f"/mesocycles/{meso_id}/sessions",
        json={"weekNumber": semana, "dayNumber": dia},
        headers=coach,
    )
    r.raise_for_status()
    ses = r.json()
    cuando = (datetime.now(UTC) - timedelta(days=hace_dias)).isoformat()
    sets = [
        {
            "clientId": str(uuid.uuid4()),
            "sessionExerciseId": ex["id"],
            "index": s["index"],
            "weightKg": s["targetWeightKg"],
            "reps": str(s["targetReps"]),
            "done": True,
            "loggedAt": cuando,
        }  # fmt: skip
        for ex in ses["exercises"]
        for s in ex["sets"]
    ]
    r = await c.post(f"/sessions/{ses['id']}/sets", json={"sets": sets}, headers=atleta)
    r.raise_for_status()
    for ex in ses["exercises"]:
        r = await c.post(
            f"/sessions/{ses['id']}/feedback",
            headers=atleta,
            json={"sessionExerciseId": ex["id"], "feedback": FEEDBACK},
        )
        r.raise_for_status()
    (await c.post(f"/sessions/{ses['id']}/complete", headers=atleta)).raise_for_status()


async def main() -> None:
    print(f"Contra {API}")
    admin_email = input("Email del administrador: ").strip()
    admin_password = getpass.getpass("Contrasena del administrador: ")

    async with httpx.AsyncClient(base_url=API, timeout=60) as c:
        admin = await login(c, admin_email, admin_password)
        r = await c.get("/admin/users", headers=admin)
        if r.status_code == 403:
            raise SystemExit(
                f"{admin_email} entra, pero no es administrador. Usa la del panel /admin."
            )
        r.raise_for_status()
        usuarios = r.json()

        coach_id, coach = await asegurar(
            c, admin, usuarios,
            ("/admin/coaches", {"email": COACH_EMAIL, "displayName": COACH_NOMBRE}),
            COACH_EMAIL, secrets.token_urlsafe(24),
        )  # fmt: skip
        atleta_id, atleta = await asegurar(
            c, admin, usuarios,
            ("/admin/athletes", {
                "email": ATLETA_EMAIL, "displayName": ATLETA_NOMBRE, "coachId": coach_id,
                "months": 12, "note": "Cuenta de prueba",
            }),
            ATLETA_EMAIL, ATLETA_PASSWORD,
        )  # fmt: skip

        r = await c.get("/mesocycles", headers=coach)
        r.raise_for_status()
        if any(m["athleteId"] == atleta_id for m in r.json()):
            print("El atleta de prueba ya tiene bloque: solo se repuso la contrasena.")
            return

        r = await c.get("/exercises", headers=coach)
        r.raise_for_status()
        cat = {e["name"]: e["id"] for e in r.json()}

        r = await c.post(
            "/mesocycles",
            headers=coach,
            json={
                "athleteId": atleta_id,
                "name": "Bloque de prueba",
                "totalWeeks": 5,
                "aggressiveness": "Media",
                "daysPerWeek": 3,
                "days": [
                    {"dayNumber": 1, "name": "Pierna"},
                    {"dayNumber": 2, "name": "Empuje"},
                    {"dayNumber": 3, "name": "Tirón"},
                ],
                "exercises": [
                    basico(cat, "Sentadilla lowbar", 1,
                           [(100, 4, 5), (105, 4, 5), (110, 4, 4), (115, 3, 3), (90, 3, 5)],
                           backoff=True),
                    accesorio(cat, "Prensa de piernas", 1, 180, 8, 12, 10),
                    accesorio(cat, "Curl femoral tumbado", 1, 40, 10, 15, 2.5),
                    basico(cat, "Press banca competicion", 2,
                           [(70, 4, 5), (72.5, 4, 5), (75, 4, 4), (77.5, 3, 3), (60, 3, 5)]),
                    accesorio(cat, "Press militar con barra", 2, 40, 6, 8, 2.5),
                    accesorio(cat, "Elevaciones laterales", 2, 10, 12, 20, 1),
                    accesorio(cat, "Extension en polea con cuerda", 2, 25, 10, 15, 2.5),
                    accesorio(cat, "Peso muerto convencional", 3, 140, 3, 6, 5),
                    accesorio(cat, "Remo con barra", 3, 60, 6, 10, 2.5),
                    accesorio(cat, "Jalon al pecho", 3, 55, 8, 15, 5),
                    accesorio(cat, "Curl con barra", 3, 30, 8, 12, 2.5),
                ],
            },
        )  # fmt: skip
        r.raise_for_status()
        meso = r.json()["id"]
        for semana, dia, hace in [(1, 1, 8), (1, 2, 6), (1, 3, 4), (2, 1, 2)]:
            await entrenar(c, coach, atleta, meso, semana, dia, hace)

    print(f"Listo: {ATLETA_EMAIL}, con un bloque de 5 semanas y 4 sesiones hechas.")


if __name__ == "__main__":
    asyncio.run(main())

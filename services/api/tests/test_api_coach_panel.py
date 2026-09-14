"""El panel del coach, contra la API real.

Esto es lo que sustituye a `apps/mobile/src/data/clients.ts`. Los tests montan
un mesociclo, entrenan varias sesiones y comprueban que las cifras y las
alertas salen de los datos y no de un literal.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.test_api_auth import auth, login, register


@pytest_asyncio.fixture
async def gym(client: AsyncClient, admin: dict) -> dict:
    coach_mail, _ = await register(client, admin, "coach")
    atleta_mail, atleta = await register(client, admin, "athlete")
    ca = auth(await login(client, coach_mail))
    aa = auth(await login(client, atleta_mail))
    await client.post("/api/v1/coach/athletes", headers=ca, json={"email": atleta_mail})

    cat = await client.post(
        "/api/v1/exercises",
        headers=ca,
        json={
            "name": "Press banca",
            "muscle": "CHEST",
            "equipment": "Barra",
            "repLo": 6,
            "repHi": 10,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    meso = await client.post(
        "/api/v1/mesocycles",
        headers=ca,
        json={
            "athleteId": atleta["id"],
            "name": "Push/Pull/Legs",
            "totalWeeks": 6,
            "aggressiveness": "Media",
            "exercises": [
                {
                    "catalogId": cat.json()["id"],
                    "repLo": 6,
                    "repHi": 10,
                    "targetRir": 2,
                    "loadIncrementKg": 2.5,
                    "startingLoadKg": 60.0,
                    "startingReps": 8,
                    "startingSets": 3,
                }
            ],
        },
    )
    return {"ca": ca, "aa": aa, "atleta": atleta, "meso": meso.json()}


async def _entrenar(
    client: AsyncClient,
    gym: dict,
    semana: int,
    *,
    rpe: str,
    joint: str = "Ninguno",
    peso: float = 60.0,
    cerrar: bool = True,
) -> dict:
    """Genera una sesion, la registra entera y la cierra."""
    s = await client.post(
        f"/api/v1/mesocycles/{gym['meso']['id']}/sessions",
        headers=gym["ca"],
        json={"weekNumber": semana, "dayLabel": f"Push {semana}"},
    )
    assert s.status_code == 201, s.text
    data = s.json()
    se_id = data["exercises"][0]["id"]

    await client.post(
        f"/api/v1/sessions/{data['id']}/sets",
        headers=gym["aa"],
        json={
            "sets": [
                {
                    "clientId": str(uuid.uuid4()),
                    "sessionExerciseId": se_id,
                    "index": i,
                    "weightKg": peso,
                    "reps": "8",
                    "rpe": rpe,
                    "done": True,
                }
                for i in range(3)
            ]
        },
    )
    await client.post(
        f"/api/v1/sessions/{data['id']}/feedback",
        headers=gym["aa"],
        json={
            "sessionExerciseId": se_id,
            "feedback": {
                "joint": joint,
                "soreness": "Se fue justo a tiempo",
                "pump": "Moderado",
                "volume": "Justo",
            },
        },
    )
    if cerrar:
        await client.post(f"/api/v1/sessions/{data['id']}/complete", headers=gym["ca"])
    return data


async def _summary(client: AsyncClient, gym: dict) -> dict:
    r = await client.get(
        f"/api/v1/coach/athletes/{gym['atleta']['id']}/summary", headers=gym["ca"]
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_un_atleta_sin_sesiones_no_rompe_el_panel(client: AsyncClient, gym: dict) -> None:
    data = await _summary(client, gym)
    assert data["mesocycleName"] == "Push/Pull/Legs"
    assert data["adherence"] is None
    assert data["sessions"] == []


@pytest.mark.asyncio
async def test_la_adherencia_sale_de_las_sesiones_reales(
    client: AsyncClient, gym: dict
) -> None:
    await _entrenar(client, gym, 1, rpe="8")
    await _entrenar(client, gym, 2, rpe="8")
    await _entrenar(client, gym, 3, rpe="8", cerrar=False)

    data = await _summary(client, gym)
    assert data["adherence"] == 67  # 2 de 3
    assert len(data["sessions"]) == 3


@pytest.mark.asyncio
async def test_tres_sesiones_al_limite_generan_la_alerta(
    client: AsyncClient, gym: dict
) -> None:
    """La alerta que el prototipo tenia escrita a mano, ahora calculada.

    RPE 10 es RIR 0. Tres seguidas: el patron que el coach necesita ver.
    """
    for semana in (1, 2, 3):
        await _entrenar(client, gym, semana, rpe="10")

    data = await _summary(client, gym)
    kinds = {a["kind"] for a in data["alerts"]}
    assert "rir_al_limite" in kinds

    alerta = next(a for a in data["alerts"] if a["kind"] == "rir_al_limite")
    assert alerta["subject"] == "Press banca"
    assert "hard set" in alerta["suggestion"]


@pytest.mark.asyncio
async def test_dos_semanas_de_dolor_generan_la_alerta(client: AsyncClient, gym: dict) -> None:
    await _entrenar(client, gym, 1, rpe="8", joint="Moderado")
    await _entrenar(client, gym, 2, rpe="8", joint="Moderado")

    data = await _summary(client, gym)
    assert "dolor_articular" in {a["kind"] for a in data["alerts"]}


@pytest.mark.asyncio
async def test_entrenar_bien_no_genera_alertas_de_ejercicio(
    client: AsyncClient, gym: dict
) -> None:
    """Un panel que avisa de todo no avisa de nada."""
    for semana, peso in ((1, 60.0), (2, 65.0), (3, 70.0)):
        await _entrenar(client, gym, semana, rpe="8", peso=peso)

    data = await _summary(client, gym)
    kinds = {a["kind"] for a in data["alerts"]}
    assert "rir_al_limite" not in kinds
    assert "e1rm_estancado" not in kinds
    assert "dolor_articular" not in kinds


@pytest.mark.asyncio
async def test_el_tonelaje_se_calcula_de_los_sets(client: AsyncClient, gym: dict) -> None:
    await _entrenar(client, gym, 1, rpe="8", peso=60.0)
    data = await _summary(client, gym)

    sesion = data["sessions"][0]
    assert sesion["status"] == "Completa"
    assert sesion["setsDone"] == 3
    assert sesion["tonnageKg"] == 60.0 * 8 * 3


@pytest.mark.asyncio
async def test_la_cabecera_cuenta_atletas_y_alertas(client: AsyncClient, gym: dict) -> None:
    for semana in (1, 2, 3):
        await _entrenar(client, gym, semana, rpe="10")

    r = await client.get("/api/v1/coach/overview", headers=gym["ca"])
    assert r.status_code == 200
    data = r.json()
    assert data["athletes"] == 1
    assert data["sessionsLast7Days"] == 3
    assert data["openAlerts"] >= 1


@pytest.mark.asyncio
async def test_un_coach_ajeno_no_ve_el_resumen(
    client: AsyncClient, gym: dict, admin: dict
) -> None:
    otro_mail, _ = await register(client, admin, "coach")
    otro = auth(await login(client, otro_mail))

    r = await client.get(f"/api/v1/coach/athletes/{gym['atleta']['id']}/summary", headers=otro)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_el_atleta_no_entra_al_panel(client: AsyncClient, gym: dict) -> None:
    r = await client.get(
        f"/api/v1/coach/athletes/{gym['atleta']['id']}/summary", headers=gym["aa"]
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_la_lista_de_clientes_llega_en_una_sola_peticion(
    client: AsyncClient, gym: dict
) -> None:
    """La alternativa sería N peticiones desde el teléfono, una por atleta."""
    for semana in (1, 2, 3):
        await _entrenar(client, gym, semana, rpe="10")

    r = await client.get("/api/v1/coach/athletes/summaries", headers=gym["ca"])
    assert r.status_code == 200, r.text

    cards = r.json()
    assert len(cards) == 1

    card = cards[0]
    assert card["athlete"]["id"] == gym["atleta"]["id"]
    assert card["mesocycleName"] == "Push/Pull/Legs"
    assert card["alertCount"] >= 1
    assert card["topAlert"]["kind"] == "rir_al_limite"


@pytest.mark.asyncio
async def test_la_alerta_destacada_prioriza_los_warning(client: AsyncClient, gym: dict) -> None:
    """Un 'info' no puede tapar un dolor articular en la lista."""
    await _entrenar(client, gym, 1, rpe="8", joint="Moderado")
    await _entrenar(client, gym, 2, rpe="8", joint="Moderado")

    r = await client.get("/api/v1/coach/athletes/summaries", headers=gym["ca"])
    card = r.json()[0]
    assert card["topAlert"]["severity"] == "warning"


@pytest.mark.asyncio
async def test_un_atleta_sin_bloque_activo_no_rompe_la_lista(
    client: AsyncClient, admin: dict
) -> None:
    coach_mail, _ = await register(client, admin, "coach")
    atleta_mail, _ = await register(client, admin, "athlete")
    ca = auth(await login(client, coach_mail))
    await client.post("/api/v1/coach/athletes", headers=ca, json={"email": atleta_mail})

    r = await client.get("/api/v1/coach/athletes/summaries", headers=ca)
    assert r.status_code == 200

    card = r.json()[0]
    assert card["mesocycleName"] is None
    assert card["adherence"] is None
    assert card["alertCount"] == 0
    assert card["topAlert"] is None


@pytest.mark.asyncio
async def test_el_atleta_no_lista_clientes(client: AsyncClient, gym: dict) -> None:
    r = await client.get("/api/v1/coach/athletes/summaries", headers=gym["aa"])
    assert r.status_code == 403

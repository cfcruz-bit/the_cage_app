"""El reparto de autoridad, probado extremo a extremo.

    el motor sugiere, el coach decide, el atleta ejecuta

Cada test de este archivo corresponde a una frase que dijo el cliente. Si uno
falla, no es un bug tecnico: es el producto haciendo algo que no debe.

El escenario es siempre el mismo: dos coaches, dos atletas, y el coach A lleva
solo al atleta A. Todo lo que el coach B intente sobre el atleta A tiene que
terminar en 404 —no en 403—, porque un 403 confirmaria que ese recurso existe.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.test_api_auth import auth, login, register


async def _catalogo(client: AsyncClient, headers: dict[str, str]) -> str:
    r = await client.post(
        "/api/v1/exercises",
        headers=headers,
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
    assert r.status_code == 201, r.text
    return r.json()["id"]


class Escenario:
    def __init__(self, **kw: object) -> None:
        self.__dict__.update(kw)


@pytest_asyncio.fixture
async def mundo(client: AsyncClient, admin: dict) -> Escenario:
    coach_a_mail, _ = await register(client, admin, "coach")
    coach_b_mail, _ = await register(client, admin, "coach")
    atleta_a_mail, atleta_a = await register(client, admin, "athlete")
    atleta_b_mail, atleta_b = await register(client, admin, "athlete")

    ca = auth(await login(client, coach_a_mail))
    cb = auth(await login(client, coach_b_mail))
    aa = auth(await login(client, atleta_a_mail))
    ab = auth(await login(client, atleta_b_mail))

    # Cada coach lleva a un atleta.
    for headers, mail in ((ca, atleta_a_mail), (cb, atleta_b_mail)):
        r = await client.post("/api/v1/coach/athletes", headers=headers, json={"email": mail})
        assert r.status_code == 201, r.text

    catalog_id = await _catalogo(client, ca)

    meso = await client.post(
        "/api/v1/mesocycles",
        headers=ca,
        json={
            "athleteId": atleta_a["id"],
            "name": "Push/Pull/Legs",
            "totalWeeks": 6,
            "aggressiveness": "Media",
            "exercises": [
                {
                    "catalogId": catalog_id,
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
    assert meso.status_code == 201, meso.text

    return Escenario(
        ca=ca,
        cb=cb,
        aa=aa,
        ab=ab,
        atleta_a=atleta_a,
        atleta_b=atleta_b,
        catalog_id=catalog_id,
        meso=meso.json(),
    )


# ── El atleta no escribe su plan ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_el_atleta_no_puede_crear_mesociclos(
    client: AsyncClient, mundo: Escenario
) -> None:
    """Palabras del cliente: 'el atleta no puede anadir mesociclos'."""
    r = await client.post(
        "/api/v1/mesocycles",
        headers=mundo.aa,
        json={
            "athleteId": mundo.atleta_a["id"],
            "name": "El mio",
            "totalWeeks": 4,
            "exercises": [
                {
                    "catalogId": mundo.catalog_id,
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
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_el_atleta_no_puede_cambiar_su_prescripcion(
    client: AsyncClient, mundo: Escenario
) -> None:
    """'el coach es el que pauta cuantas series o repeticiones hara el atleta'."""
    mex_id = mundo.meso["exercises"][0]["id"]
    r = await client.put(
        f"/api/v1/mesocycles/{mundo.meso['id']}/exercises/{mex_id}/prescription",
        headers=mundo.aa,
        json={"sets": 10, "restSeconds": 60},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_el_atleta_no_genera_sus_propias_sesiones(
    client: AsyncClient, mundo: Escenario
) -> None:
    r = await client.post(
        f"/api/v1/mesocycles/{mundo.meso['id']}/sessions",
        headers=mundo.aa,
        json={"weekNumber": 1, "dayNumber": 1, "dayLabel": "Push A"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_el_atleta_no_crea_ejercicios_de_catalogo(
    client: AsyncClient, mundo: Escenario
) -> None:
    r = await client.post(
        "/api/v1/exercises",
        headers=mundo.aa,
        json={
            "name": "Invento",
            "muscle": "CHEST",
            "equipment": "Barra",
            "repLo": 6,
            "repHi": 10,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_el_atleta_si_puede_leer_su_mesociclo(
    client: AsyncClient, mundo: Escenario
) -> None:
    r = await client.get(f"/api/v1/mesocycles/{mundo.meso['id']}", headers=mundo.aa)
    assert r.status_code == 200
    assert r.json()["name"] == "Push/Pull/Legs"


# ── Un coach no toca atletas ajenos ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_un_coach_ajeno_no_ve_el_mesociclo(client: AsyncClient, mundo: Escenario) -> None:
    """404 y no 403: un 403 confirmaria que ese mesociclo existe."""
    r = await client.get(f"/api/v1/mesocycles/{mundo.meso['id']}", headers=mundo.cb)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_un_coach_ajeno_no_prescribe(client: AsyncClient, mundo: Escenario) -> None:
    mex_id = mundo.meso["exercises"][0]["id"]
    r = await client.put(
        f"/api/v1/mesocycles/{mundo.meso['id']}/exercises/{mex_id}/prescription",
        headers=mundo.cb,
        json={"sets": 2, "restSeconds": 300},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_un_coach_no_crea_mesociclos_para_atletas_que_no_lleva(
    client: AsyncClient, mundo: Escenario
) -> None:
    r = await client.post(
        "/api/v1/mesocycles",
        headers=mundo.cb,
        json={
            "athleteId": mundo.atleta_a["id"],
            "name": "Secuestro",
            "totalWeeks": 4,
            "exercises": [
                {
                    "catalogId": mundo.catalog_id,
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
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_un_atleta_ajeno_no_ve_el_mesociclo(
    client: AsyncClient, mundo: Escenario
) -> None:
    r = await client.get(f"/api/v1/mesocycles/{mundo.meso['id']}", headers=mundo.ab)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_la_cartera_solo_muestra_los_propios(
    client: AsyncClient, mundo: Escenario
) -> None:
    r = await client.get("/api/v1/coach/athletes", headers=mundo.ca)
    assert r.status_code == 200
    ids = {u["id"] for u in r.json()}
    assert mundo.atleta_a["id"] in ids
    assert mundo.atleta_b["id"] not in ids


@pytest.mark.asyncio
async def test_un_coach_no_se_anade_a_si_mismo(client: AsyncClient, mundo: Escenario) -> None:
    me = await client.get("/api/v1/auth/me", headers=mundo.ca)
    r = await client.post(
        "/api/v1/coach/athletes",
        headers=mundo.ca,
        json={"email": me.json()["email"]},
    )
    # Es un coach, no un atleta: ni siquiera llega a la comprobacion de igualdad.
    assert r.status_code == 404


# ── Listado de mesociclos ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_el_coach_lista_los_mesociclos_de_su_cartera(
    client: AsyncClient, mundo: Escenario
) -> None:
    r = await client.get("/api/v1/mesocycles", headers=mundo.ca)
    assert r.status_code == 200

    lista = r.json()
    assert len(lista) == 1
    assert lista[0]["athleteName"] == "Test"
    assert lista[0]["exerciseCount"] == 1


@pytest.mark.asyncio
async def test_un_coach_ajeno_recibe_una_lista_vacia(
    client: AsyncClient, mundo: Escenario
) -> None:
    """Vacía y no 403: no hay nada que confirmarle."""
    r = await client.get("/api/v1/mesocycles", headers=mundo.cb)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_el_atleta_solo_ve_los_suyos(client: AsyncClient, mundo: Escenario) -> None:
    propios = await client.get("/api/v1/mesocycles", headers=mundo.aa)
    assert [m["id"] for m in propios.json()] == [mundo.meso["id"]]

    ajenos = await client.get("/api/v1/mesocycles", headers=mundo.ab)
    assert ajenos.json() == []


@pytest.mark.asyncio
async def test_el_filtro_por_atleta_no_deja_sondear(
    client: AsyncClient, mundo: Escenario
) -> None:
    """Si el filtro se respetara para el atleta, comparando respuestas podría
    averiguar qué otros atletas existen."""
    r = await client.get(
        f"/api/v1/mesocycles?athleteId={mundo.atleta_a['id']}", headers=mundo.ab
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_el_detalle_trae_las_cargas_de_arranque(
    client: AsyncClient, mundo: Escenario
) -> None:
    """El móvil las necesita para proyectar el mesociclo con el mismo motor."""
    r = await client.get(f"/api/v1/mesocycles/{mundo.meso['id']}", headers=mundo.ca)
    ex = r.json()["exercises"][0]
    assert ex["startingLoadKg"] == 60.0
    assert ex["startingReps"] == 8
    assert ex["startingSets"] == 3


@pytest.mark.asyncio
async def test_el_filtro_por_atleta_funciona_de_verdad(
    client: AsyncClient, mundo: Escenario
) -> None:
    """El filtro tiene que FILTRAR, no ignorarse.

    Sin alias en el parámetro de consulta, `athleteId` no se enlaza y la lista
    vuelve entera. Se comprueba pidiendo un atleta que el coach lleva pero cuyo
    mesociclo no es el único: si el filtro se ignorara, saldrían los dos.
    """
    con_filtro = await client.get(
        f"/api/v1/mesocycles?athleteId={mundo.atleta_b['id']}", headers=mundo.ca
    )
    assert con_filtro.status_code == 200
    # El coach A no lleva al atleta B: filtrando por él, nada.
    assert con_filtro.json() == []

    sin_filtro = await client.get("/api/v1/mesocycles", headers=mundo.ca)
    assert len(sin_filtro.json()) == 1

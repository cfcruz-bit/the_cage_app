"""Las marcas de fuerza: historial, vigencia y quien puede tocarlas.

El escenario es el de `test_api_permissions`: dos coaches, dos atletas, y el
coach A lleva solo al atleta A.

Lo que mas se prueba aqui no es el CRUD sino **cual es la marca vigente**, que
es de donde saldran todos los pesos de un bloque programado por porcentaje. Si
eso se equivoca, el atleta entrena con el peso de otro dia y nadie se entera
hasta que la barra no sube.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.test_api_permissions import mundo  # noqa: F401  (fixture)


def _marca(exercise_id: str, kg: float, dia: str, source: str = "test") -> dict:
    return {
        "exerciseId": exercise_id,
        "valueKg": kg,
        "achievedOn": dia,
        "source": source,
    }


# ── La marca vigente ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_la_vigente_es_la_mas_reciente_por_fecha_no_la_ultima_escrita(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    """El caso real: el lunes apuntas la marca del sabado.

    Esa no debe desplazar a la del domingo, que es posterior aunque se
    escribiera antes. Si se ordenara por fecha de escritura, el atleta pasaria
    a entrenar con porcentajes de una marca vieja.
    """
    url = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"

    # Domingo: 180. Se escribe primero.
    r = await client.post(
        url, headers=mundo.ca, json=_marca(mundo.catalog_id, 180, "2026-09-13")
    )
    assert r.status_code == 201, r.text

    # Sabado: 175. Se escribe despues, pero es ANTERIOR.
    r = await client.post(
        url, headers=mundo.ca, json=_marca(mundo.catalog_id, 175, "2026-09-12")
    )
    assert r.status_code == 201, r.text

    vigentes = (await client.get(url, headers=mundo.ca)).json()
    assert len(vigentes) == 1
    assert vigentes[0]["valueKg"] == 180
    assert vigentes[0]["achievedOn"] == "2026-09-13"
    assert vigentes[0]["current"] is True


@pytest.mark.asyncio
async def test_el_historial_completo_sale_con_only_current_false(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    url = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"
    for kg, dia in ((160, "2026-06-01"), (170, "2026-07-01"), (180, "2026-08-01")):
        r = await client.post(url, headers=mundo.ca, json=_marca(mundo.catalog_id, kg, dia))
        assert r.status_code == 201, r.text

    historial = (await client.get(f"{url}?onlyCurrent=false", headers=mundo.ca)).json()
    assert [m["valueKg"] for m in historial] == [180, 170, 160], "de mas reciente a mas vieja"
    assert [m["current"] for m in historial] == [True, False, False]

    solo_vigente = (await client.get(url, headers=mundo.ca)).json()
    assert len(solo_vigente) == 1


@pytest.mark.asyncio
async def test_repetir_la_fecha_corrige_en_vez_de_fallar(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    """Escribir dos veces el mismo dia es un dedazo, no un segundo test.

    Sin este caso, corregir un 1850 mal tecleado devolveria un 500 contra el
    UNIQUE de la base.
    """
    url = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"
    await client.post(url, headers=mundo.ca, json=_marca(mundo.catalog_id, 185, "2026-09-12"))
    r = await client.post(
        url, headers=mundo.ca, json=_marca(mundo.catalog_id, 180, "2026-09-12")
    )
    assert r.status_code == 201, r.text

    historial = (await client.get(f"{url}?onlyCurrent=false", headers=mundo.ca)).json()
    assert len(historial) == 1, "se corrigio, no se duplico"
    assert historial[0]["valueKg"] == 180


@pytest.mark.asyncio
async def test_borrar_la_vigente_devuelve_el_mando_a_la_anterior(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    url = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"
    await client.post(url, headers=mundo.ca, json=_marca(mundo.catalog_id, 170, "2026-07-01"))
    r = await client.post(
        url, headers=mundo.ca, json=_marca(mundo.catalog_id, 180, "2026-08-01")
    )
    nueva = r.json()["id"]

    borrada = await client.delete(f"{url}/{nueva}", headers=mundo.ca)
    assert borrada.status_code == 204

    vigentes = (await client.get(url, headers=mundo.ca)).json()
    assert len(vigentes) == 1
    assert vigentes[0]["valueKg"] == 170


# ── Quien puede que ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_el_atleta_lee_las_suyas_pero_no_las_escribe(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    """La regla de toda la API: el atleta reporta, no pauta.

    Su marca es el numero del que salen todos los pesos de su bloque; dejarle
    escribirla seria dejarle programarse solo por la puerta de atras.
    """
    url = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"
    await client.post(url, headers=mundo.ca, json=_marca(mundo.catalog_id, 180, "2026-09-12"))

    leidas = await client.get(url, headers=mundo.aa)
    assert leidas.status_code == 200
    assert leidas.json()[0]["valueKg"] == 180

    escritas = await client.post(
        url, headers=mundo.aa, json=_marca(mundo.catalog_id, 300, "2026-09-13")
    )
    assert escritas.status_code == 403, "403 y no 404: sabe que existe, es el mismo"


@pytest.mark.asyncio
async def test_las_marcas_ajenas_son_404_para_todos(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    """Ni el coach de otro ni un atleta cualquiera. Y 404, nunca 403."""
    url = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"
    await client.post(url, headers=mundo.ca, json=_marca(mundo.catalog_id, 180, "2026-09-12"))

    for headers, quien in ((mundo.cb, "el coach B"), (mundo.ab, "el atleta B")):
        leer = await client.get(url, headers=headers)
        assert leer.status_code == 404, f"{quien} pudo LEER: {leer.text}"

        # Un peso VALIDO a proposito: con 999 kg la validacion del cuerpo
        # responde 422 antes de llegar a la comprobacion de permisos, y el
        # test pasaria sin haber probado lo que dice probar.
        escribir = await client.post(
            url, headers=headers, json=_marca(mundo.catalog_id, 180, "2026-09-14")
        )
        assert escribir.status_code == 404, f"{quien} pudo ESCRIBIR: {escribir.text}"


@pytest.mark.asyncio
async def test_un_coach_no_borra_la_marca_de_un_atleta_ajeno(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    """El id del atleta en la ruta no autoriza el id de la marca.

    Sin la comprobacion cruzada, el coach B podria borrar cualquier marca del
    sistema poniendo a SU atleta en la ruta.
    """
    url_a = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"
    r = await client.post(
        url_a, headers=mundo.ca, json=_marca(mundo.catalog_id, 180, "2026-09-12")
    )
    marca_de_a = r.json()["id"]

    url_b = f"/api/v1/athletes/{mundo.atleta_b['id']}/records"
    robo = await client.delete(f"{url_b}/{marca_de_a}", headers=mundo.cb)
    assert robo.status_code == 404

    sigue = (await client.get(url_a, headers=mundo.ca)).json()
    assert len(sigue) == 1, "la marca del atleta A tiene que seguir ahi"


# ── Validacion ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_la_api_rechaza_marcas_imposibles(
    client: AsyncClient,
    mundo,  # noqa: F811
) -> None:
    url = f"/api/v1/athletes/{mundo.atleta_a['id']}/records"
    casos = [
        (_marca(mundo.catalog_id, 0, "2026-09-12"), "cero kilos"),
        (_marca(mundo.catalog_id, -100, "2026-09-12"), "peso negativo"),
        (_marca(mundo.catalog_id, 1000, "2026-09-12"), "mas que el record mundial"),
        (_marca(mundo.catalog_id, 180, "2026-09-12", "inventado"), "origen inventado"),
    ]
    for cuerpo, que in casos:
        r = await client.post(url, headers=mundo.ca, json=cuerpo)
        assert r.status_code == 422, f"acepto {que}: {r.text}"

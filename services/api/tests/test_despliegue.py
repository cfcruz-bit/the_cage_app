"""Dos regresiones que solo aparecen al desplegar de verdad.

Ninguna de las dos la detectaba la suite: la primera porque los tests corren
sobre SQLite y el sintoma solo se ve en Postgres, y la segunda porque el script
de alta del administrador no pasa por la API y nadie lo ejercitaba.
"""

from __future__ import annotations

import pytest

from app.models import Prescription
from scripts.create_admin import normalizar_email


def test_el_indice_parcial_esta_declarado_en_el_modelo() -> None:
    """El indice que impide dos prescripciones base vive en los modelos.

    Si solo existiera en la migracion, `alembic check` contra Postgres lo veria
    reflejado en la base, no lo encontraria en los modelos y propondria
    BORRARLO. Un `--autogenerate` a ciegas habria generado esa migracion y
    tirado la unica proteccion contra dos bases simultaneas para el mismo
    ejercicio.

    En SQLite el sintoma no aparece porque los indices parciales no se reflejan
    con su condicion, asi que `migrations/env.py` los excluye ahi a proposito.
    """
    indices = {i.name: i for i in Prescription.__table__.indexes}
    assert "uq_prescriptions_base" in indices, (
        "uq_prescriptions_base no esta en los modelos: alembic propondria borrarlo en Postgres"
    )

    indice = indices["uq_prescriptions_base"]
    assert indice.unique, "sin unique no impide nada"
    assert [c.name for c in indice.columns] == ["mesocycle_exercise_id"]

    # La condicion parcial tiene que ir en los DOS dialectos: sin la de
    # Postgres el indice seria unique a secas y prohibiria mas de una
    # prescripcion por ejercicio, que es justo lo contrario de lo que queremos.
    for dialecto in ("sqlite", "postgresql"):
        condicion = indice.dialect_options[dialecto].get("where")
        assert condicion is not None, f"falta la condicion parcial para {dialecto}"
        assert "week_number IS NULL" in str(condicion)


@pytest.mark.parametrize(
    "crudo, esperado",
    [
        ("  Camilo@TheCage.NI  ", "camilo@thecage.ni"),
        ("entrenador@gmail.com", "entrenador@gmail.com"),
    ],
)
def test_normalizar_email_acepta_y_limpia(crudo: str, esperado: str) -> None:
    assert normalizar_email(crudo) == esperado


@pytest.mark.parametrize(
    "malo",
    [
        "admin@thecage.test",  # TLD reservado: la API lo rechaza
        "admin@localhost",  # sin dominio real
        "esto-no-es-un-email",
        "admin@",
        "",
    ],
)
def test_normalizar_email_rechaza_lo_que_la_api_rechazaria(malo: str) -> None:
    """El script validaba solo que hubiera una arroba.

    Con esa comprobacion se podia crear un administrador con un email que el
    endpoint de login rechaza con 422 — imposible de usar. Y como el script se
    niega a crear un segundo admin, la unica salida era editar la base a mano.
    """
    with pytest.raises(ValueError):
        normalizar_email(malo)

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


# ── El DSN que entregan los proveedores ──────────────────────────────────────


@pytest.mark.parametrize(
    "crudo, esperado",
    [
        # Neon, copiado tal cual de su panel. Sin traduccion, la app arranca y
        # muere con "connect() got an unexpected keyword argument 'sslmode'".
        (
            "postgresql://u:p@ep-abc-123.sa-east-1.aws.neon.tech/cage"
            "?sslmode=require&channel_binding=require",
            "postgresql+asyncpg://u:p@ep-abc-123.sa-east-1.aws.neon.tech/cage?ssl=require",
        ),
        # El endpoint con pooler de Neon: ademas se apaga la cache de
        # sentencias preparadas, o PgBouncer las mezcla entre sesiones.
        (
            "postgresql://u:p@ep-abc-123-pooler.sa-east-1.aws.neon.tech/cage?sslmode=require",
            "postgresql+asyncpg://u:p@ep-abc-123-pooler.sa-east-1.aws.neon.tech/cage"
            "?prepared_statement_cache_size=0&ssl=require",
        ),
        # Supabase marca el pooler de otra forma.
        (
            "postgres://u:p@db.supabase.co:6543/postgres?pgbouncer=true",
            "postgresql+asyncpg://u:p@db.supabase.co:6543/postgres"
            "?pgbouncer=true&prepared_statement_cache_size=0",
        ),
        # Fly, tras `attach`: sin parametros, red privada, sin TLS.
        (
            "postgres://cage:xyz@the-cage-db.flycast:5432/cage",
            "postgresql+asyncpg://cage:xyz@the-cage-db.flycast:5432/cage",
        ),
        # Si ya viene bien escrito, no se toca.
        (
            "postgresql+asyncpg://u:p@h/d?ssl=require",
            "postgresql+asyncpg://u:p@h/d?ssl=require",
        ),
        # SQLite se queda como esta.
        ("sqlite+aiosqlite:///./cage.db", "sqlite+aiosqlite:///./cage.db"),
    ],
)
def test_el_dsn_del_proveedor_se_traduce_a_asyncpg(crudo: str, esperado: str) -> None:
    from app.core.config import Settings

    ajustes = Settings(database_url=crudo, jwt_secret="x" * 40)
    assert ajustes.database_url == esperado


@pytest.mark.parametrize(
    "sucio",
    [
        # Copiado a mano del panel de Neon, que lo muestra partido en dos.
        "postgresql://u:p@ep-little-mountain-b59php65.c-7.us\n"
        "-east-2.aws.neon.tech/neondb?sslmode=require",
        "postgresql://u:p@ep-little-mountain-b59php65.c-7.us "
        "-east-2.aws.neon.tech/neondb?sslmode=require",
        # Con espacios alrededor, que es lo que deja un copiar-pegar apurado.
        "  postgresql://u:p@ep-little-mountain-b59php65.c-7."
        "us-east-2.aws.neon.tech/neondb?sslmode=require\n",
    ],
)
def test_el_dsn_sobrevive_a_un_copiado_con_saltos_de_linea(sucio: str) -> None:
    """Un salto de linea en medio del host rompe SQLAlchemy muy lejos de aqui.

    El error que sale es `Could not parse SQLAlchemy URL from given URL string`
    dentro de Alembic, sin ninguna pista de que el problema es un caracter
    invisible en una variable de entorno.
    """
    from app.core.config import Settings

    esperado = (
        "postgresql+asyncpg://u:p@ep-little-mountain-b59php65.c-7."
        "us-east-2.aws.neon.tech/neondb?ssl=require"
    )
    assert Settings(database_url=sucio, jwt_secret="x" * 40).database_url == esperado

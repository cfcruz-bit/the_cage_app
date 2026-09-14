"""Las reglas de cobro, sin base de datos.

Aritmetica de calendario y nada mas. Son las funciones donde un error se
traduce en cobrarle de mas a un cliente o regalarle un mes, asi que se prueban
aparte de todo lo demas.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.membership import WARN_DAYS_BEFORE, add_months


def test_un_mes_normal() -> None:
    assert add_months(date(2026, 3, 10), 1) == date(2026, 4, 10)


def test_el_31_de_enero_mas_un_mes_es_fin_de_febrero() -> None:
    """El caso que rompe cualquier implementacion con timedelta(days=30)."""
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)


def test_en_anio_bisiesto_cae_en_el_29() -> None:
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)


def test_cruzar_el_fin_de_anio() -> None:
    assert add_months(date(2026, 11, 15), 3) == date(2027, 2, 15)


def test_doce_meses_es_un_anio_exacto() -> None:
    assert add_months(date(2026, 6, 1), 12) == date(2027, 6, 1)


def test_cero_meses_no_tiene_sentido() -> None:
    with pytest.raises(ValueError):
        add_months(date(2026, 6, 1), 0)


def test_el_aviso_son_cinco_dias() -> None:
    """Decision del cliente. Si cambia, cambia tambien el texto de la app."""
    assert WARN_DAYS_BEFORE == 5

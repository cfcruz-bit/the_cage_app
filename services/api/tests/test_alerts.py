"""Las reglas de alerta, una por una.

Puras: sin base de datos, sin HTTP. Cada test es el caso minimo que dispara (o
no dispara) una regla.
"""

from __future__ import annotations

from app.domain.alerts import (
    LOW_ADHERENCE,
    AlertKind,
    ExerciseHistory,
    Severity,
    alerts_for_exercise,
    alerts_for_mesocycle,
)


def _history(
    rir: tuple[int, ...] = (),
    joint: tuple[str, ...] = (),
    e1rms: tuple[float, ...] = (),
) -> ExerciseHistory:
    return ExerciseHistory(
        exercise_name="Press banca",
        muscle="CHEST",
        rir_by_session=rir,
        joint_by_session=joint,
        e1rm_by_session=e1rms,
    )


def _kinds(history: ExerciseHistory) -> set[AlertKind]:
    return {a.kind for a in alerts_for_exercise(history)}


# ── RIR al limite ────────────────────────────────────────────────────────────


def test_tres_sesiones_a_rir_cero_avisan() -> None:
    assert AlertKind.RIR_AL_LIMITE in _kinds(_history(rir=(2, 0, 0, 0)))


def test_dos_sesiones_a_rir_cero_no_avisan() -> None:
    """Dos pueden ser un mal dia. Tres es un patron."""
    assert AlertKind.RIR_AL_LIMITE not in _kinds(_history(rir=(2, 0, 0)))


def test_la_racha_se_cuenta_desde_la_ultima_sesion() -> None:
    """Tres sesiones al limite hace dos meses no dicen nada de hoy."""
    assert AlertKind.RIR_AL_LIMITE not in _kinds(_history(rir=(0, 0, 0, 2, 2)))


def test_el_aviso_de_rir_es_warning() -> None:
    alerts = alerts_for_exercise(_history(rir=(0, 0, 0)))
    assert alerts[0].severity is Severity.WARNING
    assert "Press banca" in alerts[0].text


# ── Dolor articular ──────────────────────────────────────────────────────────


def test_dos_semanas_de_dolor_moderado_avisan() -> None:
    assert AlertKind.DOLOR_ARTICULAR in _kinds(
        _history(joint=("Ninguno", "Moderado", "Moderado"))
    )


def test_dolor_mucho_tambien_cuenta() -> None:
    assert AlertKind.DOLOR_ARTICULAR in _kinds(_history(joint=("Mucho", "Moderado")))


def test_poco_dolor_no_avisa() -> None:
    """Algo de molestia es normal; avisar por eso seria ruido."""
    assert AlertKind.DOLOR_ARTICULAR not in _kinds(_history(joint=("Poco", "Poco", "Poco")))


# ── e1RM estancado ───────────────────────────────────────────────────────────


def test_tres_sesiones_sin_subir_el_e1rm_avisan() -> None:
    assert AlertKind.E1RM_ESTANCADO in _kinds(_history(e1rms=(100.0, 100.0, 100.0)))


def test_una_bajada_tambien_es_estancamiento() -> None:
    assert AlertKind.E1RM_ESTANCADO in _kinds(_history(e1rms=(100.0, 98.0, 97.0)))


def test_progresar_no_avisa() -> None:
    assert AlertKind.E1RM_ESTANCADO not in _kinds(_history(e1rms=(100.0, 105.0, 110.0)))


def test_subir_y_bajar_no_cuenta_como_progreso() -> None:
    """Comparar cada sesion con la anterior daria esto por bueno. No lo es."""
    assert AlertKind.E1RM_ESTANCADO in _kinds(_history(e1rms=(100.0, 95.0, 100.0)))


def test_medio_kilo_de_diferencia_es_ruido_de_placas() -> None:
    assert AlertKind.E1RM_ESTANCADO in _kinds(_history(e1rms=(100.0, 100.5, 100.2)))


def test_con_menos_de_tres_sesiones_no_se_concluye_nada() -> None:
    assert AlertKind.E1RM_ESTANCADO not in _kinds(_history(e1rms=(100.0, 100.0)))


# ── Mesociclo ────────────────────────────────────────────────────────────────


def test_la_adherencia_baja_avisa() -> None:
    alerts = alerts_for_mesocycle(
        sessions_completed=6,
        sessions_planned=10,
        current_week_index=1,
        total_weeks=6,
    )
    kinds = {a.kind for a in alerts}
    assert AlertKind.ADHERENCIA_BAJA in kinds
    assert "60%" in next(a.text for a in alerts if a.kind is AlertKind.ADHERENCIA_BAJA)


def test_la_adherencia_en_el_umbral_no_avisa() -> None:
    assert LOW_ADHERENCE == 0.80
    alerts = alerts_for_mesocycle(
        sessions_completed=8,
        sessions_planned=10,
        current_week_index=1,
        total_weeks=6,
    )
    assert AlertKind.ADHERENCIA_BAJA not in {a.kind for a in alerts}


def test_un_meso_sin_sesiones_no_divide_por_cero() -> None:
    alerts = alerts_for_mesocycle(
        sessions_completed=0,
        sessions_planned=0,
        current_week_index=0,
        total_weeks=6,
    )
    assert AlertKind.ADHERENCIA_BAJA not in {a.kind for a in alerts}


def test_la_ultima_semana_avisa_de_generar_el_siguiente() -> None:
    alerts = alerts_for_mesocycle(
        sessions_completed=10,
        sessions_planned=10,
        current_week_index=5,
        total_weeks=6,
    )
    assert AlertKind.MESO_TERMINANDO in {a.kind for a in alerts}


def test_a_mitad_de_bloque_no_avisa_de_cierre() -> None:
    alerts = alerts_for_mesocycle(
        sessions_completed=10,
        sessions_planned=10,
        current_week_index=2,
        total_weeks=6,
    )
    assert AlertKind.MESO_TERMINANDO not in {a.kind for a in alerts}

"""La cartera del coach.

Todo lo de aqui exige rol coach. La relacion con cada atleta se crea
explicitamente: no basta con conocer su email para ver sus datos, hace falta
una fila en `coach_athletes`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import CoachUser, SessionDep, coach_leads_athlete
from app.api.dto import (
    AlertOut,
    AthleteCardOut,
    AthleteSummaryOut,
    CoachOverviewOut,
    LinkAthleteRequest,
    SessionSummaryOut,
    UserOut,
)
from app.domain.alerts import Alert, Severity
from app.models import CoachAthlete, Mesocycle, TrainingSession, User, UserRole
from app.services.analytics import (
    athlete_alerts,
    recent_sessions,
    session_volume,
)

router = APIRouter(prefix="/coach", tags=["coach"])


@router.get("/athletes", response_model=list[UserOut])
async def list_athletes(coach: CoachUser, session: SessionDep) -> list[User]:
    found = await session.execute(
        select(User)
        .join(CoachAthlete, CoachAthlete.athlete_id == User.id)
        .where(CoachAthlete.coach_id == coach.id)
        .order_by(User.display_name)
    )
    return list(found.scalars())


@router.post("/athletes", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def link_athlete(body: LinkAthleteRequest, coach: CoachUser, session: SessionDep) -> User:
    """Da de alta en la cartera a un atleta que YA tiene cuenta.

    No crea la cuenta. Un coach no deberia poder fabricar usuarios con
    contrasenas que el elige: el atleta se registra y luego se vincula.
    """
    found = await session.execute(select(User).where(User.email == body.email))
    athlete = found.scalar_one_or_none()

    if athlete is None or athlete.role != UserRole.ATHLETE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay ningun atleta con ese email",
        )
    if athlete.id == coach.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes anadirte a tu propia cartera",
        )

    already = await session.execute(
        select(CoachAthlete).where(
            CoachAthlete.coach_id == coach.id,
            CoachAthlete.athlete_id == athlete.id,
        )
    )
    if already.scalar_one_or_none() is None:
        session.add(CoachAthlete(coach_id=coach.id, athlete_id=athlete.id))
        await session.commit()

    return athlete


# ── Panel ────────────────────────────────────────────────────────────────────


@router.get("/overview", response_model=CoachOverviewOut)
async def overview(coach: CoachUser, session: SessionDep) -> CoachOverviewOut:
    """Las cifras de cabecera: cartera, actividad y alertas abiertas."""
    athletes = await session.execute(
        select(CoachAthlete.athlete_id).where(CoachAthlete.coach_id == coach.id)
    )
    athlete_ids = list(athletes.scalars())

    if not athlete_ids:
        return CoachOverviewOut(athletes=0, sessions_last_7_days=0, open_alerts=0)

    since = datetime.now(UTC) - timedelta(days=7)
    recent = await session.scalar(
        select(func.count(TrainingSession.id))
        .join(Mesocycle, TrainingSession.mesocycle_id == Mesocycle.id)
        .where(
            Mesocycle.athlete_id.in_(athlete_ids),
            TrainingSession.completed_at.is_not(None),
            TrainingSession.completed_at >= since,
        )
    )

    open_alerts = 0
    for athlete_id in athlete_ids:
        _meso, alerts, _done, _planned = await athlete_alerts(session, athlete_id)
        open_alerts += len(alerts)

    return CoachOverviewOut(
        athletes=len(athlete_ids),
        sessions_last_7_days=int(recent or 0),
        open_alerts=open_alerts,
    )


@router.get("/athletes/summaries", response_model=list[AthleteCardOut])
async def athlete_cards(coach: CoachUser, session: SessionDep) -> list[AthleteCardOut]:
    """La lista de clientes entera, en una sola peticion.

    La alternativa —que el telefono pida el resumen de cada atleta— serian N
    peticiones por pantalla sobre una red que puede ser mala. Aqui son N
    consultas contra una base local al servidor, que es otra cosa.
    """
    found = await session.execute(
        select(User)
        .join(CoachAthlete, CoachAthlete.athlete_id == User.id)
        .where(CoachAthlete.coach_id == coach.id)
        .order_by(User.display_name)
    )

    cards: list[AthleteCardOut] = []
    for athlete in found.scalars():
        meso, alerts, completed, planned = await athlete_alerts(session, athlete.id)
        worst = _worst(alerts)
        cards.append(
            AthleteCardOut(
                athlete=UserOut.model_validate(athlete),
                mesocycle_id=meso.id if meso else None,
                mesocycle_name=meso.name if meso else None,
                current_week=(meso.current_week_index + 1) if meso else None,
                total_weeks=meso.total_weeks if meso else None,
                progress=(
                    round((meso.current_week_index + 1) / meso.total_weeks * 100) if meso else 0
                ),
                adherence=round(completed / planned * 100) if planned else None,
                alert_count=len(alerts),
                top_alert=_to_alert_out(worst) if worst is not None else None,
            )
        )
    return cards


def _worst(alerts: list[Alert]) -> Alert | None:
    """La alerta mas urgente. Un warning gana a cualquier info."""
    if not alerts:
        return None
    warnings = [a for a in alerts if a.severity is Severity.WARNING]
    return warnings[0] if warnings else alerts[0]


def _to_alert_out(alert: Alert) -> AlertOut:
    return AlertOut(
        kind=alert.kind.value,
        severity=alert.severity.value,
        subject=alert.subject,
        text=alert.text,
        suggestion=alert.suggestion,
    )


@router.get("/athletes/{athlete_id}/summary", response_model=AthleteSummaryOut)
async def athlete_summary(
    athlete_id: uuid.UUID, coach: CoachUser, session: SessionDep
) -> AthleteSummaryOut:
    """La tarjeta del atleta, con datos reales.

    404 si no esta en la cartera de este coach: confirmar que ese atleta existe
    ya seria informacion.
    """
    if not await coach_leads_athlete(session, coach.id, athlete_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")

    athlete = await session.get(User, athlete_id)
    if athlete is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")

    meso, alerts, completed, planned = await athlete_alerts(session, athlete_id)

    sessions: list[SessionSummaryOut] = []
    if meso is not None:
        for ts in await recent_sessions(session, meso.id):
            sets_done, tonnage = await session_volume(session, ts.id)
            sessions.append(
                SessionSummaryOut(
                    id=ts.id,
                    week_number=ts.week_number,
                    day_label=ts.day_label,
                    is_deload=ts.is_deload,
                    completed_at=ts.completed_at,
                    status=_status_of(ts, sets_done),
                    sets_done=sets_done,
                    tonnage_kg=tonnage,
                )
            )

    return AthleteSummaryOut(
        athlete=UserOut.model_validate(athlete),
        mesocycle_id=meso.id if meso else None,
        mesocycle_name=meso.name if meso else None,
        current_week=(meso.current_week_index + 1) if meso else None,
        total_weeks=meso.total_weeks if meso else None,
        progress=(round((meso.current_week_index + 1) / meso.total_weeks * 100) if meso else 0),
        adherence=round(completed / planned * 100) if planned else None,
        alerts=[_to_alert_out(a) for a in alerts],
        sessions=sessions,
    )


def _status_of(ts: TrainingSession, sets_done: int) -> str:
    """Los mismos cuatro estados que pintaba el prototipo."""
    if ts.completed_at is not None:
        return "Completa"
    if sets_done > 0:
        return "Parcial"
    if ts.started_at is not None:
        return "Perdida"
    return "Pendiente"

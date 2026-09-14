"""Panel de administracion: altas y cobros.

Todo lo de aqui exige rol admin. Es la unica parte de la API que crea usuarios:
el registro publico esta cerrado porque en este producto las cuentas se dan, no
se piden.

Dos decisiones de diseño que conviene entender:

**La contrasena provisional se muestra una sola vez.** No se guarda en claro en
ningun sitio; lo que se persiste es su hash, como cualquier otra. Si se pierde
antes de dársela al cliente, se regenera. Esto es lo que permite que el admin
deje de conocer la contrasena de sus clientes en cuanto entran y la cambian.

**Renovar SUMA, no reemplaza.** Cada pago es una fila en `memberships` con sus
fechas. Pagar antes de que venza el mes en curso encadena el periodo nuevo al
final del actual: el cliente que paga puntual no pierde dias por hacerlo bien.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import date

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.api.deps import AdminUser, SessionDep
from app.api.dto import (
    AdminUserRow,
    CreateAthleteRequest,
    CreateCoachRequest,
    CreatedUserOut,
    MembershipOut,
    RenewRequest,
    UserOut,
)
from app.api.v1.auth import describe
from app.core.security import hash_password
from app.models import CoachAthlete, Membership, User, UserRole
from app.services.membership import WARN_DAYS_BEFORE, access_status, grant

router = APIRouter(prefix="/admin", tags=["admin"])

#: Alfabeto sin caracteres que se confunden al dictarlos por telefono o
#: WhatsApp: nada de O/0, l/1/I. Una contrasena provisional que el cliente
#: teclea mal tres veces es una llamada tuya.
_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

#: 12 caracteres de ese alfabeto son ~71 bits. De sobra para algo que vive unas
#: horas, y todavia dictable.
_TEMP_LENGTH = 12


def generate_password() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_TEMP_LENGTH))


async def _ensure_email_free(session: SessionDep, email: str) -> None:
    found = await session.execute(select(User.id).where(User.email == email))
    if found.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una cuenta con ese email",
        )


@router.post("/coaches", response_model=CreatedUserOut, status_code=status.HTTP_201_CREATED)
async def create_coach(
    body: CreateCoachRequest, session: SessionDep, _admin: AdminUser
) -> CreatedUserOut:
    """Alta de entrenador. Sin fechas: su acceso no caduca."""
    await _ensure_email_free(session, body.email)

    temporary = generate_password()
    coach = User(
        email=body.email,
        password_hash=hash_password(temporary),
        display_name=body.display_name,
        role=UserRole.COACH.value,
        must_change_password=True,
    )
    session.add(coach)
    await session.commit()
    await session.refresh(coach)

    return CreatedUserOut(user=await describe(session, coach), temporary_password=temporary)


@router.post("/athletes", response_model=CreatedUserOut, status_code=status.HTTP_201_CREATED)
async def create_athlete(
    body: CreateAthleteRequest, session: SessionDep, admin: AdminUser
) -> CreatedUserOut:
    """Alta de atleta: cuenta, primer periodo pagado y entrenador asignado.

    Las tres cosas en una sola transaccion. Si algo falla, no queda un atleta a
    medias sin coach o sin acceso.
    """
    await _ensure_email_free(session, body.email)

    coach = await session.get(User, body.coach_id)
    if coach is None or coach.role != UserRole.COACH or not coach.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ese entrenador no existe o no esta activo",
        )

    temporary = generate_password()
    athlete = User(
        email=body.email,
        password_hash=hash_password(temporary),
        display_name=body.display_name,
        role=UserRole.ATHLETE.value,
        must_change_password=True,
    )
    session.add(athlete)
    await session.flush()

    session.add(CoachAthlete(coach_id=coach.id, athlete_id=athlete.id))
    await grant(
        session,
        athlete.id,
        months=body.months,
        created_by_id=admin.id,
        note=body.note,
    )

    await session.commit()
    await session.refresh(athlete)

    return CreatedUserOut(user=await describe(session, athlete), temporary_password=temporary)


@router.post("/athletes/{athlete_id}/renew", response_model=UserOut)
async def renew(
    athlete_id: uuid.UUID,
    body: RenewRequest,
    session: SessionDep,
    admin: AdminUser,
) -> UserOut:
    """Registra un pago. Encadena al periodo vigente si todavia lo hay."""
    athlete = await _athlete_or_404(session, athlete_id)
    await grant(
        session,
        athlete.id,
        months=body.months,
        created_by_id=admin.id,
        note=body.note,
    )
    await session.commit()
    return await describe(session, athlete)


@router.get("/athletes/{athlete_id}/memberships", response_model=list[MembershipOut])
async def membership_history(
    athlete_id: uuid.UUID, session: SessionDep, _admin: AdminUser
) -> list[Membership]:
    """El historial de cobros de un atleta, del mas reciente al mas antiguo."""
    await _athlete_or_404(session, athlete_id)
    found = await session.execute(
        select(Membership)
        .where(Membership.athlete_id == athlete_id)
        .order_by(Membership.ends_on.desc())
    )
    return list(found.scalars())


@router.post("/users/{user_id}/password", response_model=CreatedUserOut)
async def reset_password(
    user_id: uuid.UUID, session: SessionDep, _admin: AdminUser
) -> CreatedUserOut:
    """Genera una contrasena provisional nueva. Para cuando alguien la pierde.

    Revoca nada por si mismo: las sesiones abiertas se cierran solas cuando el
    usuario cambia la provisional, que es lo primero que la API le deja hacer.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    if user.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contrasena de un administrador se cambia desde su cuenta",
        )

    temporary = generate_password()
    user.password_hash = hash_password(temporary)
    user.must_change_password = True
    await session.commit()

    return CreatedUserOut(user=await describe(session, user), temporary_password=temporary)


@router.post("/users/{user_id}/active", response_model=UserOut)
async def set_active(
    user_id: uuid.UUID, active: bool, session: SessionDep, _admin: AdminUser
) -> UserOut:
    """Activa o desactiva una cuenta.

    Baja logica, nunca borrado: el historico de entrenamientos es el activo
    real del producto y no se tira porque alguien deje de venir un mes.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    if user.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes desactivar una cuenta de administrador",
        )

    user.is_active = active
    await session.commit()
    return await describe(session, user)


@router.get("/users", response_model=list[AdminUserRow])
async def list_users(session: SessionDep, _admin: AdminUser) -> list[AdminUserRow]:
    """Todo el mundo, con su estado de acceso resuelto para hoy."""
    coach = aliased(User)
    found = await session.execute(
        select(User, coach.display_name)
        .outerjoin(CoachAthlete, CoachAthlete.athlete_id == User.id)
        .outerjoin(coach, coach.id == CoachAthlete.coach_id)
        .order_by(User.role, User.display_name)
    )

    rows: list[AdminUserRow] = []
    for user, coach_name in found.all():
        access = await access_status(session, user)
        rows.append(
            AdminUserRow(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                role=user.role,
                is_active=user.is_active,
                must_change_password=user.must_change_password,
                coach_name=coach_name,
                access_ends_on=access.ends_on,
                days_left=access.days_left,
                status=_status_label(user.role, access.allowed, access.days_left),
            )
        )
    return rows


def _status_label(role: str, allowed: bool, days_left: int | None) -> str:
    if role in {UserRole.ADMIN.value, UserRole.COACH.value}:
        return "no caduca"
    if not allowed:
        return "vencido" if days_left is None else "sin acceso"
    if days_left is not None and days_left <= WARN_DAYS_BEFORE:
        return "por vencer"
    return "activo"


async def _athlete_or_404(session: SessionDep, athlete_id: uuid.UUID) -> User:
    athlete = await session.get(User, athlete_id)
    if athlete is None or athlete.role != UserRole.ATHLETE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    return athlete


@router.get("/today")
async def today() -> dict[str, str]:
    """La fecha del SERVIDOR. El panel la usa para no depender del reloj del PC."""
    return {"date": date.today().isoformat()}

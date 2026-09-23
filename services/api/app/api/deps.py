"""Dependencias de FastAPI: quien eres y que puedes tocar.

Este archivo es el perimetro de seguridad de la API. Todo lo que devuelva datos
de un atleta pasa por aqui.

Tres reglas que no se negocian:

1. **El token identifica; la base autoriza.** El JWT dice quien firmo la
   sesion. El rol y la relacion coach-atleta se comprueban contra la base en
   cada peticion, porque un token es una afirmacion del pasado: el rol pudo
   cambiar, la cuenta pudo desactivarse, el atleta pudo dejar de ser cliente.

2. **404, no 403, para lo ajeno.** Si un coach pide el mesociclo de un atleta
   que no lleva, la respuesta es "no existe". Un 403 confirmaria que ese
   recurso existe, y eso ya es informacion.

3. **El atleta no escribe su propio plan.** Es una regla explicita del
   cliente: puede marcar sets como hechos y reportar feedback, nada mas. Sets,
   repeticiones, carga, descanso y mesociclos los pauta el coach.

4. **El acceso del atleta caduca.** Sin periodo pagado vigente, la API le
   responde 402 y el movil le enseña "Necesita renovar su pago". El coach y el
   admin no caducan: son personal, no clientes.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import InvalidToken, decode_token
from app.db.session import get_session
from app.models import CoachAthlete, Mesocycle, User, UserRole
from app.services.membership import EXPIRED_MESSAGE, access_status

#: auto_error=False para poder devolver nuestro propio mensaje en vez del
#: "Not authenticated" de Starlette.
bearer = HTTPBearer(auto_error=False)

CREDENCIALES_INVALIDAS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Credenciales invalidas o caducadas",
    headers={"WWW-Authenticate": "Bearer"},
)

SOLO_COACH = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Esta accion solo la puede hacer un coach",
)

SOLO_ATLETA = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Esta accion solo la puede hacer un atleta",
)

NO_ENCONTRADO = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="No encontrado",
)

SOLO_ADMIN = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Esta accion solo la puede hacer un administrador",
)

#: 402 Payment Required. Existe justo para esto y no se usa para nada mas en
#: esta API, asi que el movil puede tratarlo como un caso propio sin mirar el
#: cuerpo de la respuesta.
PAGO_PENDIENTE = HTTPException(
    status_code=status.HTTP_402_PAYMENT_REQUIRED,
    detail=EXPIRED_MESSAGE,
)

CAMBIO_DE_CONTRASENA_PENDIENTE = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Tienes que cambiar tu contrasena provisional antes de continuar",
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_current_user(
    session: SessionDep,
    settings: SettingsDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> User:
    """El usuario del token, releido de la base.

    Releerlo no es redundante. Entre que se firmo el token y ahora, la cuenta
    pudo desactivarse o cambiar de rol; si nos fiaramos del payload, esos
    cambios tardarian hasta 30 minutos en aplicarse.
    """
    if creds is None or not creds.credentials:
        raise CREDENCIALES_INVALIDAS

    try:
        payload = decode_token(settings, creds.credentials, "access")
    except InvalidToken as exc:
        raise CREDENCIALES_INVALIDAS from exc

    user = await session.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise CREDENCIALES_INVALIDAS
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def active_user(session: SessionDep, user: CurrentUser) -> User:
    """El usuario, ademas, con derecho a usar la app HOY.

    Dos puertas antes de dejar pasar a cualquier pantalla real:

    - La contrasena provisional tiene que estar cambiada. Mientras no lo este,
      lo unico permitido es cambiarla; asi el admin deja de conocer la
      contrasena de sus clientes en cuanto entran la primera vez.
    - El atleta tiene que tener periodo pagado vigente.
    """
    if user.must_change_password:
        raise CAMBIO_DE_CONTRASENA_PENDIENTE

    status_ = await access_status(session, user)
    if not status_.allowed:
        raise PAGO_PENDIENTE
    return user


ActiveUser = Annotated[User, Depends(active_user)]


async def require_admin(user: CurrentUser) -> User:
    """Solo el administrador. Da de alta cuentas y registra cobros.

    NO pasa por `active_user`: el admin no caduca, y si arrastrara una
    contrasena provisional seria porque otro admin se la puso, caso que hoy no
    existe porque el primero se crea con un script.
    """
    if user.role != UserRole.ADMIN:
        raise SOLO_ADMIN
    return user


AdminUser = Annotated[User, Depends(require_admin)]


async def require_coach(user: ActiveUser) -> User:
    """Solo coaches. Para crear mesociclos, prescribir y ver la cartera."""
    if user.role != UserRole.COACH:
        raise SOLO_COACH
    return user


CoachUser = Annotated[User, Depends(require_coach)]


async def coach_leads_athlete(
    session: AsyncSession, coach_id: uuid.UUID, athlete_id: uuid.UUID
) -> bool:
    """La unica fuente de verdad sobre la autoridad de un coach."""
    found = await session.execute(
        select(CoachAthlete.athlete_id).where(
            CoachAthlete.coach_id == coach_id,
            CoachAthlete.athlete_id == athlete_id,
        )
    )
    return found.scalar_one_or_none() is not None


async def readable_mesocycle(
    mesocycle_id: uuid.UUID, session: SessionDep, user: ActiveUser
) -> Mesocycle:
    """Un mesociclo que este usuario puede LEER.

    Lo puede leer su atleta, o un coach que lleve a ese atleta. Nadie mas, ni
    siquiera el coach que lo creo si ya no lleva al atleta: la autoridad es la
    relacion actual, no el historial.
    """
    meso = await session.get(Mesocycle, mesocycle_id)
    if meso is None:
        raise NO_ENCONTRADO

    if user.role == UserRole.ATHLETE:
        if meso.athlete_id != user.id:
            raise NO_ENCONTRADO
        return meso

    if not await coach_leads_athlete(session, user.id, meso.athlete_id):
        raise NO_ENCONTRADO
    return meso


async def writable_mesocycle(
    mesocycle_id: uuid.UUID, session: SessionDep, user: ActiveUser
) -> Mesocycle:
    """Un mesociclo que este usuario puede MODIFICAR.

    Solo su coach. El atleta que lo lee aqui recibe 403, no 404: sabe
    perfectamente que su mesociclo existe, ocultarselo no protege nada y solo
    confundiria. El 404 se reserva para recursos ajenos.
    """
    if user.role != UserRole.COACH:
        raise SOLO_COACH

    meso = await session.get(Mesocycle, mesocycle_id)
    if meso is None:
        raise NO_ENCONTRADO
    if not await coach_leads_athlete(session, user.id, meso.athlete_id):
        raise NO_ENCONTRADO
    return meso

"""Registro, login, refresco y cierre de sesion.

El endpoint de login es el mas atacado de cualquier API, asi que hace tres
cosas que no son obvias:

1. **Responde lo mismo ante email inexistente y contrasena incorrecta.** Si
   distinguiera, cualquiera podria enumerar quien tiene cuenta.
2. **Verifica un hash falso cuando el usuario no existe.** Sin eso, la
   respuesta seria instantanea para emails desconocidos y tardaria 50 ms para
   los conocidos: un canal temporal que filtra lo mismo que el mensaje.
3. **Re-hashea si los parametros de Argon2 subieron.** Es el unico momento en
   que la contrasena en claro esta disponible.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import AdminUser, CurrentUser, SessionDep, SettingsDep
from app.api.dto import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
)
from app.core.security import (
    InvalidToken,
    create_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    verify_password,
)
from app.models import RefreshToken, User
from app.services.membership import access_status

router = APIRouter(prefix="/auth", tags=["auth"])

#: Hash de una contrasena que no es de nadie. Se verifica contra el cuando el
#: email no existe, para que el login tarde lo mismo en los dos casos.
_DUMMY_HASH = hash_password("no-es-la-contrasena-de-nadie")

CREDENCIALES = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Email o contrasena incorrectos",
)


async def _issue(session, settings, user: User) -> TokenPair:
    access, expires = create_token(settings, user.id, "access", user.role)
    refresh, refresh_expires = create_token(settings, user.id, "refresh")

    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(refresh),
            expires_at=refresh_expires,
        )
    )
    return TokenPair(access_token=access, refresh_token=refresh, expires_at=expires)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, session: SessionDep, _admin: AdminUser) -> UserOut:
    """Alta directa. **Solo el administrador.**

    El registro publico estuvo abierto durante el desarrollo y ya no lo esta:
    en este producto las cuentas se dan, no se piden. Para el alta normal usa
    `/admin/coaches` y `/admin/athletes`, que ademas generan la contrasena
    provisional y registran el primer periodo pagado.
    """
    existing = await session.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una cuenta con ese email",
        )

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        role=body.role,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return await describe(session, user)


@router.post("/login", response_model=TokenPair)
async def login(body: LoginRequest, session: SessionDep, settings: SettingsDep) -> TokenPair:
    found = await session.execute(select(User).where(User.email == body.email))
    user = found.scalar_one_or_none()

    if user is None:
        # Se gasta el mismo tiempo que en un usuario real, a proposito.
        verify_password(body.password, _DUMMY_HASH)
        raise CREDENCIALES

    if not user.is_active or not verify_password(body.password, user.password_hash):
        raise CREDENCIALES

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    # El login NO comprueba la membresia a proposito. Si la rechazara aqui, el
    # atleta vencido recibiria un 401 indistinguible de una contrasena mal
    # puesta. Entra, y el 402 de los demas endpoints —junto con /me— le explica
    # que le toca renovar.

    pair = await _issue(session, settings, user)
    await session.commit()
    return pair


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    body: RefreshRequest, session: SessionDep, settings: SettingsDep
) -> TokenPair:
    """Canjea un refresh token por un par nuevo, y **revoca el usado**.

    Esa rotacion es lo que limita el dano de un token robado: en cuanto el
    dueno legitimo refresca, el del atacante deja de valer (y al reves, lo que
    deja rastro en la tabla).
    """
    try:
        payload = decode_token(settings, body.refresh_token, "refresh")
    except InvalidToken as exc:
        raise CREDENCIALES from exc

    digest = hash_refresh_token(body.refresh_token)
    found = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == digest))
    stored = found.scalar_one_or_none()

    now = datetime.now(UTC)
    if stored is None or stored.revoked_at is not None:
        raise CREDENCIALES
    if stored.expires_at.replace(tzinfo=stored.expires_at.tzinfo or UTC) < now:
        raise CREDENCIALES

    user = await session.get(User, stored.user_id)
    if user is None or not user.is_active or str(user.id) != payload["sub"]:
        raise CREDENCIALES

    stored.revoked_at = now
    pair = await _issue(session, settings, user)
    await session.commit()
    return pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest, session: SessionDep) -> None:
    """Revoca ese refresh token. El access sigue valido hasta que caduque.

    Es la consecuencia de no consultar la base en cada peticion: un access
    token vive como mucho 30 minutos mas. Para expulsar a alguien de inmediato
    hay que desactivar la cuenta (`is_active = false`), que si se comprueba
    siempre.
    """
    digest = hash_refresh_token(body.refresh_token)
    found = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == digest))
    stored = found.scalar_one_or_none()
    if stored is not None and stored.revoked_at is None:
        stored.revoked_at = datetime.now(UTC)
        await session.commit()


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser, session: SessionDep) -> UserOut:
    """Quien soy y hasta cuando puedo entrar.

    El movil lo pide al arrancar: de aqui salen el aviso de renovacion y la
    pantalla de cambio de contrasena obligatorio.
    """
    return await describe(session, user)


@router.post("/change-password", response_model=UserOut)
async def change_password(
    body: ChangePasswordRequest, user: CurrentUser, session: SessionDep
) -> UserOut:
    """Cambia la contrasena. Es lo UNICO permitido con una provisional.

    Se exige la actual aunque el usuario ya este autenticado: si alguien deja
    el telefono desbloqueado encima del banco, que no le puedan cambiar la
    contrasena de la cuenta en dos toques.
    """
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contrasena actual no es correcta",
        )
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contrasena nueva tiene que ser distinta",
        )

    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False

    # Se revocan las demas sesiones: si alguien se hizo con la contrasena
    # provisional, cambiarla tiene que echarlo, no convivir con el.
    others = await session.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    )
    now = datetime.now(UTC)
    for token in others.scalars():
        token.revoked_at = now

    await session.commit()
    return await describe(session, user)


async def describe(session, user: User) -> UserOut:
    """UserOut con el estado de acceso resuelto para hoy."""
    access = await access_status(session, user)
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        must_change_password=user.must_change_password,
        access_ends_on=access.ends_on,
        days_left=access.days_left,
        renewal_warning=access.warn,
    )

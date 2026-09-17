"""Contrasenas y tokens.

Dos piezas separadas a proposito:

- **Argon2id** para las contrasenas. Es lento y usa memoria a proposito: un
  atacante con la tabla `users` robada tiene que gastar segundos y megabytes
  por intento. bcrypt seria aceptable; MD5 o SHA sin sal, no, por rapidos.
- **JWT HS256** para las sesiones. El access token es corto (30 min) y NO se
  guarda en la base; el refresh token es largo, se guarda HASHEADO y se puede
  revocar. Esa asimetria es lo que permite cerrar sesion de verdad sin
  consultar la base en cada peticion.

Ninguna funcion de este modulo toca la base de datos. Eso es de `app/services`.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings

TokenType = Literal["access", "refresh"]

#: Parametros de Argon2id. Los de por defecto de argon2-cffi, explicitos para
#: que se vea que son una decision y no un accidente. Subirlos endurece el
#: hash pero encarece cada login: mide antes de tocarlos.
PRODUCTION_PARAMS: Final[dict[str, int]] = {
    "time_cost": 3,
    "memory_cost": 65536,  # 64 MiB
    "parallelism": 4,
    "hash_len": 32,
    "salt_len": 16,
}

_hasher = PasswordHasher(**PRODUCTION_PARAMS)


def use_fast_hashing_for_tests() -> None:
    """Baja el coste de Argon2. **Solo para la suite de tests.**

    Argon2 tarda ~150 ms por hash a proposito: es lo que hace inviable probar
    contrasenas a lo bruto. Pero la suite crea decenas de cuentas y cada una
    paga ese precio, asi que correrla entera pasaba de segundos a minutos. Una
    suite de dos minutos es una suite que se deja de correr, y eso cuesta mas
    que lo que ahorra.

    Los tests comprueban la LOGICA —verificar, re-hashear, rechazar un hash
    corrupto—, no la dureza del KDF, asi que bajar el coste no debilita nada de
    lo que prueban.

    Es una funcion y no una variable de entorno a proposito: una variable se
    puede colar en produccion por accidente; esto hay que llamarlo desde el
    codigo, y el unico sitio que lo hace es `tests/conftest.py`.
    """
    global _hasher
    _hasher = PasswordHasher(
        time_cost=1, memory_cost=8192, parallelism=1, hash_len=32, salt_len=16
    )


#: Longitud minima. Corta pero real: la defensa de verdad es el rate limiting
#: del endpoint de login, no exigir simbolos raros que la gente apunta en un
#: post-it.
MIN_PASSWORD_LENGTH: Final[int] = 10


class InvalidToken(Exception):
    """El token no es valido: caducado, mal firmado o del tipo equivocado."""


def hash_password(plain: str) -> str:
    if len(plain) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"la contrasena necesita al menos {MIN_PASSWORD_LENGTH} caracteres")
    return _hasher.hash(plain)


def verify_password(plain: str, stored_hash: str) -> bool:
    """Comprueba la contrasena. Nunca lanza por una contrasena incorrecta.

    Devuelve False tambien si el hash guardado esta corrupto: un registro roto
    no puede convertirse en un 500 que le diga al atacante que ese usuario
    existe.
    """
    try:
        return _hasher.verify(stored_hash, plain)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    """True si el hash se hizo con parametros mas debiles que los actuales.

    Se comprueba en el login, cuando la contrasena en claro esta disponible por
    unos milisegundos. Es la unica oportunidad de re-hashear sin pedirle nada
    al usuario.
    """
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


# ── JWT ──────────────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


def create_token(
    settings: Settings,
    subject: uuid.UUID,
    token_type: TokenType,
    role: str | None = None,
) -> tuple[str, datetime]:
    """Firma un JWT y devuelve (token, caducidad).

    `jti` es un identificador unico del token. En el refresh sirve para
    localizar la fila de `refresh_tokens` sin guardar el token entero.

    El `role` viaja dentro del access token para ahorrar una consulta por
    peticion, PERO nunca es la ultima palabra: los permisos se comprueban
    contra la base en `app/api/deps.py`. Un token es una afirmacion del
    pasado; el rol pudo cambiar despues de firmarlo.
    """
    issued = _now()
    if token_type == "access":
        expires = issued + timedelta(minutes=settings.access_token_minutes)
    else:
        expires = issued + timedelta(days=settings.refresh_token_days)

    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "iat": int(issued.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    if role is not None:
        payload["role"] = role

    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires


def decode_token(settings: Settings, token: str, expected: TokenType) -> dict[str, Any]:
    """Verifica firma, caducidad y tipo. Lanza InvalidToken si algo falla.

    Comprobar el tipo NO es paranoia: sin ello, un refresh token —que dura un
    mes— valdria como access token, y revocarlo dejaria de servir de nada.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidToken(str(exc)) from exc

    if payload.get("type") != expected:
        raise InvalidToken(f"se esperaba un token de tipo {expected}")

    try:
        uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise InvalidToken("el subject no es un UUID") from exc

    return payload


def hash_refresh_token(token: str) -> str:
    """Hash del refresh token para guardarlo.

    SHA-256 y no Argon2 a proposito: el token ya son 200+ bits de entropia
    generados por nosotros, asi que no hay nada que un ataque de diccionario
    pueda adivinar. Argon2 aqui solo anadiria 50 ms a cada refresco.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

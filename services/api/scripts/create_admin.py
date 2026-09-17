"""Crea el primer administrador.

    python -m scripts.create_admin

Existe porque hay un problema del huevo y la gallina: las cuentas solo las crea
un admin, y al principio no hay ninguno. La salida es este script, que corre
contra la base directamente y por tanto solo lo puede usar quien ya tiene acceso
al servidor.

Es idempotente en lo que importa: si ya existe un admin, avisa y no hace nada.
Tener dos cuentas de administrador no es un error, pero casi siempre es un
descuido, y este script no es el sitio para crearlas por accidente.

La contrasena se pide por teclado y no se acepta por argumento: los argumentos
quedan en el historial del shell.
"""

from __future__ import annotations

import asyncio
import getpass
import sys

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import MIN_PASSWORD_LENGTH, hash_password
from app.db.session import build_engine, build_sessionmaker
from app.models import User, UserRole

#: El MISMO validador que usan los DTO de la API.
#:
#: Sin esto el script aceptaba cualquier cosa con una arroba, pero el endpoint
#: de login valida con EmailStr, que es mas estricto (rechaza dominios
#: reservados como .test o .local). Se podia crear un administrador con un
#: email con el que era IMPOSIBLE entrar — y como el script se niega a crear un
#: segundo admin, la unica salida era editar la base a mano.
_EMAIL = TypeAdapter(EmailStr)


def normalizar_email(crudo: str) -> str:
    """Devuelve el email en minusculas, o lanza ValueError si la API lo rechazaria."""
    limpio = crudo.strip().lower()
    try:
        return _EMAIL.validate_python(limpio)
    except ValidationError as exc:
        raise ValueError(f"La API rechazaria este email: {exc.errors()[0]['msg']}") from exc


async def create(email: str, name: str, password: str) -> str:
    email = normalizar_email(email)
    engine = build_engine(get_settings())
    factory = build_sessionmaker(engine)

    try:
        async with factory() as session:
            existing = await session.execute(
                select(User).where(User.role == UserRole.ADMIN.value)
            )
            already = existing.scalars().first()
            if already is not None:
                return f"Ya existe un administrador: {already.email}. No se ha creado nada."

            taken = await session.execute(select(User.id).where(User.email == email))
            if taken.scalar_one_or_none() is not None:
                return f"Ya hay una cuenta con el email {email}."

            session.add(
                User(
                    email=email,
                    password_hash=hash_password(password),
                    display_name=name,
                    role=UserRole.ADMIN.value,
                    # El admin elige su contrasena aqui mismo, asi que no
                    # arrastra ninguna provisional.
                    must_change_password=False,
                )
            )
            await session.commit()
            return f"Administrador creado: {email}"
    finally:
        await engine.dispose()


def main() -> None:
    print("Alta del administrador de The Cage.\n")

    try:
        email = normalizar_email(input("Email: "))
    except ValueError as exc:
        sys.exit(str(exc))

    name = input("Nombre: ").strip()
    if not name:
        sys.exit("El nombre no puede estar vacio.")

    password = getpass.getpass(f"Contrasena (minimo {MIN_PASSWORD_LENGTH}): ")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Demasiado corta: minimo {MIN_PASSWORD_LENGTH} caracteres.")
    if password != getpass.getpass("Repetir contrasena: "):
        sys.exit("Las contrasenas no coinciden.")

    print()
    print(asyncio.run(create(email, name, password)))


if __name__ == "__main__":
    main()

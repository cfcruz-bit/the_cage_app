"""dias de entrenamiento dentro del mesociclo

Hasta ahora un mesociclo era una lista plana de ejercicios y todos caian en la
misma sesion. Ahora se reparte en dias fijos para todo el bloque:

- `mesocycles.days_per_week`         cuantos dias tiene cada semana.
- `mesocycle_exercises.day_number`   a que dia pertenece cada ejercicio.
- `mesocycle_days`                   tabla nueva: solo los NOMBRES de dia.
- `training_sessions.day_number`     que dia del reparto cubre cada sesion; sin
                                     el no se sabe que dias faltan, porque
                                     `day_label` es texto libre.

El UNIQUE de `mesocycle_exercises` pasa de (mesocycle_id, position) a
(mesocycle_id, day_number, position): el orden es dentro del dia. Las filas
existentes quedan todas en el dia 1 y sus `position` ya eran unicos por
mesociclo, asi que no hay colisiones (se comprueba antes de crear el indice).

ESCRITO A MANO: los tres CHECK de las columnas anadidas (`dias_por_semana`,
`dia_positivo` x2). Alembic no detecta los CHECK de una columna anadida a una
tabla existente.

QUE NO ESTA EN LA BASE: que `mesocycle_exercises.day_number` no supere
`mesocycles.days_per_week`. Vive en otra fila, asi que no puede ser un CHECK de
tabla; lo valida la API (`POST /mesocycles` y `PUT /mesocycles/{id}/days`).
Nadie lo busque en la base.

Downgrade: borra `mesocycle_days`, quita las columnas y restaura el UNIQUE
viejo. Con mas de un dia las `position` pueden chocar al volver a ese UNIQUE
(la posicion 0 del dia 1 y la del dia 2), asi que antes se RENUMERAN por
mesociclo en el orden (dia, posicion). El reparto por dias se pierde, pero el
orden relativo dentro de cada dia se conserva.

Revision ID: e5b2c8a7d1f3
Revises: d7e1a4c9b3f5
Create Date: 2026-09-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5b2c8a7d1f3"
down_revision: str | None = "d7e1a4c9b3f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UQ_VIEJO = "uq_mesocycle_exercises_mesocycle_id_position"
UQ_NUEVO = "uq_mesocycle_exercises_mesocycle_id_day_number_position"


def upgrade() -> None:
    # Cada columna nueva va en DOS lotes: con server_default para rellenar las
    # filas que ya existen y, aparte, quitandolo (el valor real lo decide la
    # aplicacion). En el mismo lote SQLite recrea la tabla ya sin el default y
    # copia las filas viejas con NULL en una columna NOT NULL.
    with op.batch_alter_table("mesocycles", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("days_per_week", sa.Integer(), nullable=False, server_default="1")
        )
    with op.batch_alter_table("mesocycles", schema=None) as batch_op:
        batch_op.alter_column("days_per_week", server_default=None)
        batch_op.create_check_constraint(
            "dias_por_semana", "days_per_week >= 1 AND days_per_week <= 7"
        )

    # Antes de tocar el UNIQUE: todo lo que existe va al dia 1, asi que las
    # posiciones tienen que ser unicas por mesociclo o el indice nuevo falla.
    dup = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT mesocycle_id, position FROM mesocycle_exercises "
                "GROUP BY mesocycle_id, position HAVING COUNT(*) > 1"
            )
        )
        .first()
    )
    assert dup is None, f"posiciones repetidas en el mesociclo {dup[0]}; no se puede migrar"

    with op.batch_alter_table("mesocycle_exercises", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("day_number", sa.Integer(), nullable=False, server_default="1")
        )
    with op.batch_alter_table("mesocycle_exercises", schema=None) as batch_op:
        batch_op.alter_column("day_number", server_default=None)
        batch_op.create_check_constraint("dia_positivo", "day_number >= 1")
        batch_op.drop_constraint(batch_op.f(UQ_VIEJO), type_="unique")
        batch_op.create_unique_constraint(
            batch_op.f(UQ_NUEVO), ["mesocycle_id", "day_number", "position"]
        )

    with op.batch_alter_table("training_sessions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("day_number", sa.Integer(), nullable=False, server_default="1")
        )
    with op.batch_alter_table("training_sessions", schema=None) as batch_op:
        batch_op.alter_column("day_number", server_default=None)
        batch_op.create_check_constraint("dia_positivo", "day_number >= 1")

    op.create_table(
        "mesocycle_days",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mesocycle_id", sa.Uuid(), nullable=False),
        sa.Column("day_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.CheckConstraint("day_number >= 1", name=op.f("ck_mesocycle_days_dia_positivo")),
        sa.ForeignKeyConstraint(
            ["mesocycle_id"],
            ["mesocycles.id"],
            name=op.f("fk_mesocycle_days_mesocycle_id_mesocycles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mesocycle_days")),
        sa.UniqueConstraint(
            "mesocycle_id",
            "day_number",
            name=op.f("uq_mesocycle_days_mesocycle_id_day_number"),
        ),
    )
    with op.batch_alter_table("mesocycle_days", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_mesocycle_days_mesocycle_id"), ["mesocycle_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("mesocycle_days", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_mesocycle_days_mesocycle_id"))
    op.drop_table("mesocycle_days")

    with op.batch_alter_table("training_sessions", schema=None) as batch_op:
        batch_op.drop_constraint("dia_positivo", type_="check")
        batch_op.drop_column("day_number")

    # Se suelta el UNIQUE nuevo ANTES de renumerar: mientras exista, mover una
    # fila a una posicion que otra del mismo dia aun no ha dejado lo violaria.
    with op.batch_alter_table("mesocycle_exercises", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f(UQ_NUEVO), type_="unique")

    bind = op.get_bind()
    filas = bind.execute(
        sa.text(
            "SELECT id, mesocycle_id FROM mesocycle_exercises "
            "ORDER BY mesocycle_id, day_number, position"
        )
    ).all()
    siguiente: dict[object, int] = {}
    for id_, meso_id in filas:
        pos = siguiente.get(meso_id, 0)
        siguiente[meso_id] = pos + 1
        bind.execute(
            sa.text("UPDATE mesocycle_exercises SET position = :p WHERE id = :i"),
            {"p": pos, "i": id_},
        )

    with op.batch_alter_table("mesocycle_exercises", schema=None) as batch_op:
        batch_op.drop_constraint("dia_positivo", type_="check")
        batch_op.drop_column("day_number")
        batch_op.create_unique_constraint(batch_op.f(UQ_VIEJO), ["mesocycle_id", "position"])

    with op.batch_alter_table("mesocycles", schema=None) as batch_op:
        batch_op.drop_constraint("dias_por_semana", type_="check")
        batch_op.drop_column("days_per_week")

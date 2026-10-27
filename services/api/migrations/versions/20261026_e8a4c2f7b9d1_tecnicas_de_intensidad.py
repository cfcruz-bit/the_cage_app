"""tecnicas de intensidad en el ultimo set

Anade la tecnica (rest-pause, drop set, myo-reps) a `prescriptions`, donde la
pauta el coach, y a `session_exercises`, donde se congela al generar la sesion.
Igual que el back-off: todo NULL es "sin tecnica", que es lo de siempre.

Los CHECK van a mano: Alembic no los detecta en columnas anadidas.

Revision ID: e8a4c2f7b9d1
Revises: d7f3b1e9a2c4
Create Date: 2026-10-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e8a4c2f7b9d1"
down_revision: str | None = "d7f3b1e9a2c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = (
    "(technique IS NULL AND technique_rounds IS NULL AND technique_amount IS NULL) OR "
    "(technique IS NOT NULL AND technique_rounds >= 1 AND technique_rounds <= 6"
    " AND technique_amount >= 1 AND technique_amount <= 60)"
)


def upgrade() -> None:
    for table, name in (("prescriptions", "tecnica_completa"), ("session_exercises", "tecnica_congelada")):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column("technique", sa.String(length=12), nullable=True))
            batch_op.add_column(sa.Column("technique_rounds", sa.Integer(), nullable=True))
            batch_op.add_column(sa.Column("technique_amount", sa.Integer(), nullable=True))
            batch_op.create_check_constraint(name, _CHECK)


def downgrade() -> None:
    for table, name in (("session_exercises", "tecnica_congelada"), ("prescriptions", "tecnica_completa")):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_constraint(name, type_="check")
            batch_op.drop_column("technique_amount")
            batch_op.drop_column("technique_rounds")
            batch_op.drop_column("technique")

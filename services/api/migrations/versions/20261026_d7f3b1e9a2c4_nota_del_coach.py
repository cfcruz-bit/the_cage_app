"""nota fija del coach por ejercicio del bloque

Una columna nueva y opcional: los bloques que ya existen quedan sin nota.

Revision ID: d7f3b1e9a2c4
Revises: c5e2a7d9f1b3
Create Date: 2026-10-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7f3b1e9a2c4"
down_revision: str | None = "c5e2a7d9f1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("mesocycle_exercises") as batch_op:
        batch_op.add_column(sa.Column("note", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("mesocycle_exercises") as batch_op:
        batch_op.drop_column("note")

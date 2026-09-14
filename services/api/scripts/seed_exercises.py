"""Siembra el catalogo de ejercicios del sistema.

    python -m scripts.seed_exercises

Es **idempotente**: identifica cada ejercicio por (nombre, equipo) y actualiza
el que ya exista en vez de duplicarlo. Se puede correr en cada despliegue sin
pensarlo.

Solo siembra ejercicios del SISTEMA (`created_by_id` NULL), visibles para todos
los coaches. Los que cada coach cree para si mismo no se tocan nunca.

Sobre los numeros: los rangos de repeticiones y el RIR objetivo son el punto de
partida por defecto, no dogma. El coach los ajusta por atleta al montar el
mesociclo. El `load_increment_kg` si es fisico: es el salto MINIMO montable con
el material del gimnasio, y si no coincide con tus mancuernas el motor
propondra cargas imposibles.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import build_engine, build_sessionmaker
from app.models import ExerciseCatalog


@dataclass(frozen=True)
class Seed:
    name: str
    muscle: str
    equipment: str
    rep_lo: int
    rep_hi: int
    target_rir: int
    load_increment_kg: float


#: Saltos de carga tipicos. Revisa que coincidan con TU gimnasio.
BARRA = 2.5  # dos discos de 1.25
MANCUERNA = 2.5  # el salto habitual del rack
MAQUINA = 5.0  # una placa
CABLE = 2.5  # una placa de torre
CORPORAL = 2.5  # lastre en cinturon

CATALOG: tuple[Seed, ...] = (
    # ── Pecho ────────────────────────────────────────────────────────────────
    Seed("Press banca con barra", "CHEST", "Barra", 5, 8, 2, BARRA),
    Seed("Press inclinado con barra", "CHEST", "Barra", 6, 10, 2, BARRA),
    Seed("Press banca con mancuernas", "CHEST", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Press inclinado con mancuernas", "CHEST", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Aperturas en polea", "CHEST", "Cable", 12, 20, 1, CABLE),
    Seed("Fondos en paralelas", "CHEST", "Peso corporal", 6, 12, 2, CORPORAL),
    Seed("Press en maquina", "CHEST", "Maquina", 8, 15, 1, MAQUINA),
    # ── Espalda ──────────────────────────────────────────────────────────────
    Seed("Dominadas", "BACK", "Peso corporal", 5, 10, 2, CORPORAL),
    Seed("Jalon al pecho", "BACK", "Cable", 8, 15, 2, CABLE),
    Seed("Remo con barra", "BACK", "Barra", 6, 10, 2, BARRA),
    Seed("Remo con mancuerna a una mano", "BACK", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Remo en maquina", "BACK", "Maquina", 8, 15, 1, MAQUINA),
    Seed("Pull-over en polea", "BACK", "Cable", 12, 20, 1, CABLE),
    Seed("Peso muerto convencional", "BACK", "Barra", 3, 6, 3, BARRA),
    # ── Hombros ──────────────────────────────────────────────────────────────
    Seed("Press militar con barra", "SHOULDERS", "Barra", 5, 8, 2, BARRA),
    Seed("Press de hombro con mancuernas", "SHOULDERS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Elevaciones laterales", "SHOULDERS", "Mancuernas", 12, 20, 1, MANCUERNA),
    Seed("Elevaciones laterales en polea", "SHOULDERS", "Cable", 12, 20, 1, CABLE),
    Seed("Pajaros / deltoide posterior", "SHOULDERS", "Mancuernas", 12, 20, 1, MANCUERNA),
    Seed("Face pull", "SHOULDERS", "Cable", 12, 20, 1, CABLE),
    # ── Biceps ───────────────────────────────────────────────────────────────
    Seed("Curl con barra", "BICEPS", "Barra", 8, 12, 1, BARRA),
    Seed("Curl con mancuernas", "BICEPS", "Mancuernas", 8, 15, 1, MANCUERNA),
    Seed("Curl martillo", "BICEPS", "Mancuernas", 8, 15, 1, MANCUERNA),
    Seed("Curl en predicador", "BICEPS", "Maquina", 8, 15, 1, MAQUINA),
    Seed("Curl en polea", "BICEPS", "Cable", 10, 20, 1, CABLE),
    # ── Triceps ──────────────────────────────────────────────────────────────
    Seed("Press frances", "TRICEPS", "Barra", 8, 12, 1, BARRA),
    Seed("Extension en polea con cuerda", "TRICEPS", "Cable", 10, 20, 1, CABLE),
    Seed("Press cerrado", "TRICEPS", "Barra", 6, 10, 2, BARRA),
    Seed("Extension sobre la cabeza", "TRICEPS", "Mancuernas", 10, 15, 1, MANCUERNA),
    Seed("Fondos en maquina", "TRICEPS", "Maquina", 8, 15, 1, MAQUINA),
    # ── Cuadriceps ───────────────────────────────────────────────────────────
    Seed("Sentadilla libre", "QUADS", "Barra", 5, 8, 2, BARRA),
    Seed("Sentadilla frontal", "QUADS", "Barra", 5, 8, 2, BARRA),
    Seed("Prensa de piernas", "QUADS", "Maquina", 8, 15, 2, MAQUINA),
    Seed("Sentadilla hack", "QUADS", "Maquina", 8, 12, 2, MAQUINA),
    Seed("Zancadas con mancuernas", "QUADS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Extension de cuadriceps", "QUADS", "Maquina", 12, 20, 1, MAQUINA),
    # ── Isquiotibiales ───────────────────────────────────────────────────────
    Seed("Peso muerto rumano", "HAMSTRINGS", "Barra", 6, 10, 2, BARRA),
    Seed("Curl femoral tumbado", "HAMSTRINGS", "Maquina", 8, 15, 1, MAQUINA),
    Seed("Curl femoral sentado", "HAMSTRINGS", "Maquina", 8, 15, 1, MAQUINA),
    Seed("Buenos dias", "HAMSTRINGS", "Barra", 8, 12, 2, BARRA),
    # ── Gluteos ──────────────────────────────────────────────────────────────
    Seed("Hip thrust", "GLUTES", "Barra", 8, 12, 2, BARRA),
    Seed("Puente de gluteo en maquina", "GLUTES", "Maquina", 10, 15, 1, MAQUINA),
    Seed("Patada de gluteo en polea", "GLUTES", "Cable", 12, 20, 1, CABLE),
    Seed("Abduccion de cadera", "GLUTES", "Maquina", 12, 20, 1, MAQUINA),
    # ── Gemelos ──────────────────────────────────────────────────────────────
    Seed("Elevacion de talones de pie", "CALVES", "Maquina", 8, 15, 1, MAQUINA),
    Seed("Elevacion de talones sentado", "CALVES", "Maquina", 10, 20, 1, MAQUINA),
    Seed("Elevacion de talones en prensa", "CALVES", "Maquina", 10, 20, 1, MAQUINA),
    # ── Abdomen ──────────────────────────────────────────────────────────────
    Seed("Crunch en polea", "ABS", "Cable", 10, 20, 1, CABLE),
    Seed("Elevacion de piernas colgado", "ABS", "Peso corporal", 8, 15, 2, CORPORAL),
    Seed("Rueda abdominal", "ABS", "Peso corporal", 8, 15, 2, CORPORAL),
)


async def seed() -> tuple[int, int]:
    """Devuelve (creados, actualizados)."""
    engine = build_engine(get_settings())
    factory = build_sessionmaker(engine)

    created = 0
    updated = 0

    async with factory() as session:
        for item in CATALOG:
            found = await session.execute(
                select(ExerciseCatalog).where(
                    ExerciseCatalog.name == item.name,
                    ExerciseCatalog.equipment == item.equipment,
                    ExerciseCatalog.created_by_id.is_(None),
                )
            )
            row = found.scalar_one_or_none()

            if row is None:
                session.add(
                    ExerciseCatalog(
                        name=item.name,
                        muscle=item.muscle,
                        equipment=item.equipment,
                        rep_lo=item.rep_lo,
                        rep_hi=item.rep_hi,
                        target_rir=item.target_rir,
                        load_increment_kg=item.load_increment_kg,
                        created_by_id=None,
                    )
                )
                created += 1
            else:
                row.muscle = item.muscle
                row.rep_lo = item.rep_lo
                row.rep_hi = item.rep_hi
                row.target_rir = item.target_rir
                row.load_increment_kg = item.load_increment_kg
                updated += 1

        await session.commit()

    await engine.dispose()
    return created, updated


def main() -> None:
    created, updated = asyncio.run(seed())
    print(f"Catalogo sembrado: {created} nuevos, {updated} actualizados.")


if __name__ == "__main__":
    main()

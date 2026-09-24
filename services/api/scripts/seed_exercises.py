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
SMITH = 2.5  # la Smith admite los mismos discos que la barra
KETTLEBELL = 4.0  # las pesas rusas saltan de 4 en 4, no de 2.5
BANDA = 2.5  # una banda no tiene incremento real; se pone el minimo legal
LANDMINE = 2.5  # discos normales en el extremo de la barra
BALON = 1.0  # los balones medicinales van de kilo en kilo

CATALOG: tuple[Seed, ...] = (
    # ── Basicos ──────────────────────────────────────────────────────────────
    #
    # Los tres movimientos de competicion y sus variantes. Van en su propio
    # grupo porque asi se programan: primero el basico del dia, luego el
    # accesorio. Ver el docstring de MuscleGroup.BASICOS.
    #
    # Los rangos son cortos y el RIR alto a proposito. En fuerza la serie se
    # corta antes del fallo tecnico, no del muscular: una repeticion con la
    # espalda redondeada no suma, resta.
    #
    # "tempo" y los "ct" (counts, la pausa en segundos) no llevan el detalle en
    # el nombre porque el tempo exacto lo pauta el coach por semana. El nombre
    # dice que ejercicio es; la prescripcion dice como se hace ese dia.
    Seed("Press banca competicion", "BASICOS", "Barra", 1, 5, 2, BARRA),
    Seed("Press banca tempo", "BASICOS", "Barra", 3, 6, 3, BARRA),
    Seed("Press banca agarre medio", "BASICOS", "Barra", 3, 6, 2, BARRA),
    Seed("Press banca agarre cerrado", "BASICOS", "Barra", 4, 8, 2, BARRA),
    Seed("Press banca 5ct", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Press banca 3ct", "BASICOS", "Barra", 3, 6, 3, BARRA),
    Seed("Press banca larsen", "BASICOS", "Barra", 3, 6, 2, BARRA),
    Seed("Sentadilla lowbar", "BASICOS", "Barra", 1, 5, 2, BARRA),
    Seed("Sentadilla highbar", "BASICOS", "Barra", 3, 6, 2, BARRA),
    Seed("Sentadilla SSB", "BASICOS", "Barra", 4, 8, 2, BARRA),
    Seed("Sentadilla tempo", "BASICOS", "Barra", 3, 6, 3, BARRA),
    Seed("Peso muerto pausa", "BASICOS", "Barra", 2, 5, 3, BARRA),
    # ── Pecho ────────────────────────────────────────────────────────────────
    Seed("Press banca con barra", "CHEST", "Barra", 5, 8, 2, BARRA),
    Seed("Press inclinado con barra", "CHEST", "Barra", 6, 10, 2, BARRA),
    Seed("Press banca con mancuernas", "CHEST", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Press inclinado con mancuernas", "CHEST", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Aperturas en polea", "CHEST", "Cable", 12, 20, 1, CABLE),
    Seed("Aperturas sentado en polea", "CHEST", "Cable", 12, 20, 1, CABLE),
    Seed("Fondos en paralelas", "CHEST", "Peso corporal", 6, 12, 2, CORPORAL),
    Seed("Press en maquina", "CHEST", "Maquina", 8, 15, 1, MAQUINA),
    # ── Espalda ──────────────────────────────────────────────────────────────
    Seed("Dominadas", "BACK", "Peso corporal", 5, 10, 2, CORPORAL),
    Seed("Jalon al pecho", "BACK", "Cable", 8, 15, 2, CABLE),
    Seed("Remo con barra", "BACK", "Barra", 6, 10, 2, BARRA),
    Seed("Remo con mancuerna a una mano", "BACK", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Remo en maquina", "BACK", "Maquina", 8, 15, 1, MAQUINA),
    Seed("Pull-over en polea", "BACK", "Cable", 12, 20, 1, CABLE),
    Seed("Remo gironda en polea", "BACK", "Cable", 8, 15, 2, CABLE),
    Seed("Remo sentado en polea", "BACK", "Cable", 8, 15, 2, CABLE),
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
    Seed("Curl martillo en polea", "BICEPS", "Cable", 10, 20, 1, CABLE),
    # ── Triceps ──────────────────────────────────────────────────────────────
    Seed("Press frances", "TRICEPS", "Barra", 8, 12, 1, BARRA),
    Seed("JM press", "TRICEPS", "Barra", 6, 12, 2, BARRA),
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
    # ═════════════════════════════════════════════════════════════════════════
    # Segunda tanda: la libreta completa del coach.
    #
    # Aqui las variantes van SEPARADAS una por una —"Bulgara con mancuernas" y
    # "Bulgara en Smith" son dos ejercicios, no uno con dos materiales—. El
    # motivo no es purismo: cada fila lleva su propio historial de cargas, y en
    # una Smith se mueve mucho mas peso que con mancuernas. Fusionarlas haria
    # que el motor propusiera cargas imposibles al alternar entre las dos.
    # ═════════════════════════════════════════════════════════════════════════
    # ── Basicos (variantes de competicion) ────────────────────────────────────
    Seed("Sentadilla highbar pausa", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Sentadilla highbar 3:0:0", "BASICOS", "Barra", 3, 6, 3, BARRA),
    Seed("Sentadilla lowbar pausa", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Sentadilla lowbar tempo", "BASICOS", "Barra", 3, 6, 3, BARRA),
    Seed("Sentadilla lowbar pin", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Sentadilla highbar pin", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Sentadilla lowbar box", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Sentadilla highbar box", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Sentadilla zercher", "BASICOS", "Barra", 3, 6, 3, BARRA),
    Seed("Peso muerto sumo", "BASICOS", "Barra", 1, 5, 2, BARRA),
    Seed("Peso muerto sumo pausa", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto convencional pausa", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto sumo doble despegue", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto convencional doble despegue", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto complex", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto clusters", "BASICOS", "Barra", 1, 4, 2, BARRA),
    Seed("Peso muerto deficit", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto convencional deficit con pausa", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto sumo deficit", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto sumo deficit con pausa", "BASICOS", "Barra", 2, 5, 3, BARRA),
    Seed("Peso muerto desde bloques", "BASICOS", "Barra", 2, 5, 2, BARRA),
    Seed("Rack pull", "BASICOS", "Barra", 2, 6, 2, BARRA),
    Seed("Press banca 2ct", "BASICOS", "Barra", 3, 6, 3, BARRA),
    Seed("Press banca feet up", "BASICOS", "Barra", 3, 6, 2, BARRA),
    Seed("Press banca board", "BASICOS", "Barra", 2, 5, 2, BARRA),
    Seed("Spoto press", "BASICOS", "Barra", 3, 6, 3, BARRA),
    # ── Pecho ─────────────────────────────────────────────────────────────────
    Seed("Peck deck", "CHEST", "Maquina", 10, 20, 1, MAQUINA),
    Seed("Crossover alto en polea", "CHEST", "Cable", 10, 20, 1, CABLE),
    Seed("Crossover bajo en polea", "CHEST", "Cable", 10, 20, 1, CABLE),
    Seed("Aperturas con mancuernas", "CHEST", "Mancuernas", 10, 15, 1, MANCUERNA),
    Seed("Flexiones en rack", "CHEST", "Peso corporal", 8, 20, 1, CORPORAL),
    Seed("Press inclinado en Smith", "CHEST", "Smith", 6, 12, 2, SMITH),
    Seed("Toscano press", "CHEST", "Mancuernas", 8, 15, 1, MANCUERNA),
    Seed("Death press", "CHEST", "Mancuernas", 8, 15, 1, MANCUERNA),
    Seed("Floor press con barra", "CHEST", "Barra", 4, 8, 2, BARRA),
    Seed("Floor press con mancuernas", "CHEST", "Mancuernas", 6, 12, 2, MANCUERNA),
    # ── Espalda ───────────────────────────────────────────────────────────────
    Seed("Jalon al pecho agarre neutro", "BACK", "Cable", 8, 15, 2, CABLE),
    Seed("Jalon al pecho agarre supino", "BACK", "Cable", 8, 15, 2, CABLE),
    Seed("Jalon unilateral en polea", "BACK", "Cable", 10, 15, 1, CABLE),
    Seed("Remo con mancuernas bilateral", "BACK", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Seal row", "BACK", "Barra", 8, 12, 2, BARRA),
    Seed("Seal row agarre neutro", "BACK", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Remo en T agarre neutro", "BACK", "Maquina", 8, 12, 2, MAQUINA),
    Seed("Remo en T agarre prono", "BACK", "Maquina", 8, 12, 2, MAQUINA),
    Seed("Meadow row", "BACK", "Barra", 8, 12, 2, BARRA),
    Seed("Remo pendlay", "BACK", "Barra", 5, 8, 2, BARRA),
    Seed("Remo unilateral en polea", "BACK", "Cable", 10, 15, 1, CABLE),
    Seed("Farmer carry con mancuernas", "BACK", "Mancuernas", 1, 3, 2, MANCUERNA),
    Seed("Farmer carry con barra hexagonal", "BACK", "Barra hexagonal", 1, 3, 2, BARRA),
    Seed("Farmer carry con kettlebell", "BACK", "Kettlebell", 1, 3, 2, KETTLEBELL),
    Seed("Farmer carry unilateral", "BACK", "Mancuernas", 1, 3, 2, MANCUERNA),
    Seed("Dominadas agarre neutro", "BACK", "Peso corporal", 5, 10, 2, CORPORAL),
    Seed("Dominadas supinas", "BACK", "Peso corporal", 5, 10, 2, CORPORAL),
    Seed("Dominadas australianas", "BACK", "Peso corporal", 8, 15, 2, CORPORAL),
    Seed("Dominadas escapulares", "BACK", "Peso corporal", 8, 15, 1, CORPORAL),
    # ── Hombros ───────────────────────────────────────────────────────────────
    Seed("Press militar en Smith", "SHOULDERS", "Smith", 6, 10, 2, SMITH),
    Seed("Push press", "SHOULDERS", "Barra", 3, 6, 2, BARRA),
    Seed("Press militar de pie con barra", "SHOULDERS", "Barra", 4, 8, 2, BARRA),
    Seed("Press militar de pie con mancuernas", "SHOULDERS", "Mancuernas", 6, 12, 2, MANCUERNA),
    Seed("Push press unilateral", "SHOULDERS", "Mancuernas", 4, 8, 2, MANCUERNA),
    Seed("Press militar unilateral", "SHOULDERS", "Mancuernas", 6, 12, 2, MANCUERNA),
    Seed("Landmine press", "SHOULDERS", "Landmine", 6, 12, 2, LANDMINE),
    Seed("Elevaciones laterales unilaterales", "SHOULDERS", "Mancuernas", 10, 20, 1, MANCUERNA),
    Seed("Elevaciones laterales unilaterales en polea", "SHOULDERS", "Cable", 10, 20, 1, CABLE),
    Seed("Rear delt fly en polea", "SHOULDERS", "Cable", 12, 20, 1, CABLE),
    Seed("Rear delt fly en maquina", "SHOULDERS", "Maquina", 12, 20, 1, MAQUINA),
    Seed("Complejo HYWT", "SHOULDERS", "Mancuernas", 8, 15, 1, MANCUERNA),
    # ── Biceps ────────────────────────────────────────────────────────────────
    Seed("Curl con barra Z", "BICEPS", "Barra Z", 8, 12, 1, BARRA),
    Seed("Curl alterno con mancuernas", "BICEPS", "Mancuernas", 8, 15, 1, MANCUERNA),
    Seed("Curl bayesiano en polea", "BICEPS", "Cable", 10, 20, 1, CABLE),
    Seed("Curl sentado con mancuernas", "BICEPS", "Mancuernas", 8, 15, 1, MANCUERNA),
    Seed("Curl prono con barra", "BICEPS", "Barra", 8, 15, 1, BARRA),
    Seed("Curl zottman", "BICEPS", "Mancuernas", 8, 15, 1, MANCUERNA),
    Seed("Curl spider", "BICEPS", "Mancuernas", 8, 15, 1, MANCUERNA),
    # ── Triceps ───────────────────────────────────────────────────────────────
    Seed("Press frances con barra Z", "TRICEPS", "Barra Z", 8, 12, 2, BARRA),
    Seed("Press frances con mancuernas", "TRICEPS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Press frances con barra romana", "TRICEPS", "Barra", 8, 12, 2, BARRA),
    Seed("Skull crusher con barra Z", "TRICEPS", "Barra Z", 8, 12, 2, BARRA),
    Seed("Skull crusher a peso corporal", "TRICEPS", "Peso corporal", 6, 12, 2, CORPORAL),
    Seed("Extension sobre la cabeza en polea", "TRICEPS", "Cable", 10, 15, 1, CABLE),
    Seed("Extension katana en polea", "TRICEPS", "Cable", 10, 15, 1, CABLE),
    Seed("Extension katana con mancuerna", "TRICEPS", "Mancuernas", 10, 15, 1, MANCUERNA),
    Seed("Pushdown en polea con barra", "TRICEPS", "Cable", 10, 15, 1, CABLE),
    Seed("Rolling triceps extension", "TRICEPS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("William press", "TRICEPS", "Barra", 8, 12, 2, BARRA),
    Seed("California press", "TRICEPS", "Barra", 6, 10, 2, BARRA),
    Seed("JM press en Smith", "TRICEPS", "Smith", 6, 12, 2, SMITH),
    Seed("Kaz press", "TRICEPS", "Barra", 6, 10, 2, BARRA),
    Seed("Tate press", "TRICEPS", "Mancuernas", 8, 12, 2, MANCUERNA),
    # ── Antebrazo ─────────────────────────────────────────────────────────────
    Seed("Pinzas isometricas", "ANTEBRAZO", "Mancuernas", 1, 3, 1, MANCUERNA),
    Seed("Curl de dedos", "ANTEBRAZO", "Barra", 12, 20, 1, BARRA),
    Seed("Hold con barra", "ANTEBRAZO", "Barra", 1, 3, 1, BARRA),
    Seed("Death hang", "ANTEBRAZO", "Peso corporal", 1, 3, 1, CORPORAL),
    # ── Cuadriceps ────────────────────────────────────────────────────────────
    Seed("Sentadilla en Smith", "QUADS", "Smith", 6, 12, 2, SMITH),
    Seed("Belt squat", "QUADS", "Maquina", 8, 15, 2, MAQUINA),
    Seed("Zancadas caminando", "QUADS", "Mancuernas", 8, 15, 2, MANCUERNA),
    Seed("Zancadas hacia atras", "QUADS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Zancadas frontales", "QUADS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Bulgara en Smith", "QUADS", "Smith", 8, 12, 2, SMITH),
    Seed("Bulgara con mancuernas", "QUADS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Bulgara con barra", "QUADS", "Barra", 6, 10, 2, BARRA),
    Seed("Bulgara con SSB", "QUADS", "Barra", 6, 10, 2, BARRA),
    Seed("Step up en Smith", "QUADS", "Smith", 8, 12, 2, SMITH),
    Seed("Step up con mancuernas", "QUADS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Sissy squat", "QUADS", "Peso corporal", 8, 15, 1, CORPORAL),
    # ── Femorales ─────────────────────────────────────────────────────────────
    Seed("Peso muerto rumano con mancuernas", "HAMSTRINGS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Peso muerto rumano en Smith", "HAMSTRINGS", "Smith", 8, 12, 2, SMITH),
    Seed("Peso muerto rumano agarre snatch", "HAMSTRINGS", "Barra", 6, 10, 2, BARRA),
    Seed("Peso muerto rumano a una pierna", "HAMSTRINGS", "Mancuernas", 8, 12, 2, MANCUERNA),
    Seed("Curl femoral de pie", "HAMSTRINGS", "Maquina", 10, 15, 1, MAQUINA),
    Seed("Peso muerto piernas rigidas", "HAMSTRINGS", "Barra", 6, 10, 2, BARRA),
    Seed("Hiperextension", "HAMSTRINGS", "Peso corporal", 10, 20, 1, CORPORAL),
    # ── Gluteos ───────────────────────────────────────────────────────────────
    Seed("Puente de gluteo", "GLUTES", "Peso corporal", 12, 20, 1, CORPORAL),
    Seed("Puente de gluteo a una pierna", "GLUTES", "Peso corporal", 10, 20, 1, CORPORAL),
    Seed("Hip thrust doble pulso", "GLUTES", "Barra", 8, 15, 1, BARRA),
    Seed("Patada de gluteo con banda", "GLUTES", "Banda", 12, 20, 1, BANDA),
    Seed("Patada lateral con banda", "GLUTES", "Banda", 12, 20, 1, BANDA),
    Seed("Patada lateral en polea", "GLUTES", "Cable", 12, 20, 1, CABLE),
    Seed("Swing con kettlebell", "GLUTES", "Kettlebell", 10, 20, 2, KETTLEBELL),
    Seed("Pull through en polea", "GLUTES", "Cable", 10, 20, 1, CABLE),
    # ── Pantorrilla ───────────────────────────────────────────────────────────
    Seed("Elevacion de talones burro", "CALVES", "Maquina", 10, 20, 1, MAQUINA),
    Seed("Elevacion de talones en Smith", "CALVES", "Smith", 10, 20, 1, SMITH),
    Seed("Elevacion de tibiales", "CALVES", "Maquina", 12, 20, 1, MAQUINA),
    # ── Aductores ─────────────────────────────────────────────────────────────
    Seed("Copenhagen plank", "ADUCTORES", "Peso corporal", 1, 3, 1, CORPORAL),
    Seed("Copenhagen dip", "ADUCTORES", "Peso corporal", 8, 15, 1, CORPORAL),
    Seed("Aduccion de cadera en maquina", "ADUCTORES", "Maquina", 12, 20, 1, MAQUINA),
    Seed("Patada de aductor en polea", "ADUCTORES", "Cable", 12, 20, 1, CABLE),
    Seed("Sentadilla lateral", "ADUCTORES", "Mancuernas", 8, 15, 2, MANCUERNA),
    # ── Core ──────────────────────────────────────────────────────────────────
    Seed("Toes to bar", "ABS", "Peso corporal", 5, 15, 1, CORPORAL),
    Seed("Plancha", "ABS", "Peso corporal", 1, 3, 1, CORPORAL),
    Seed("Plancha lateral", "ABS", "Peso corporal", 1, 3, 1, CORPORAL),
    Seed("Superman plank", "ABS", "Peso corporal", 1, 3, 1, CORPORAL),
    Seed("Mountain climbers", "ABS", "Peso corporal", 10, 30, 1, CORPORAL),
    Seed("Hollow hold", "ABS", "Peso corporal", 1, 3, 1, CORPORAL),
    Seed("Hollow rock", "ABS", "Peso corporal", 10, 20, 1, CORPORAL),
    Seed("Elevacion de piernas en suelo", "ABS", "Peso corporal", 10, 20, 1, CORPORAL),
    Seed("Crunch", "ABS", "Peso corporal", 12, 25, 1, CORPORAL),
    Seed("Cocoon", "ABS", "Peso corporal", 10, 20, 1, CORPORAL),
    Seed("V-ups", "ABS", "Peso corporal", 8, 20, 1, CORPORAL),
    Seed("Press pallof", "ABS", "Cable", 8, 15, 1, CABLE),
    Seed("Antirrotacion en landmine", "ABS", "Landmine", 8, 15, 1, LANDMINE),
    Seed("Russian twist", "ABS", "Peso corporal", 10, 30, 1, CORPORAL),
    # ── Circuitos de cardio ───────────────────────────────────────────────────
    Seed("Burpee", "CARDIO", "Peso corporal", 8, 20, 1, CORPORAL),
    Seed("Devil press", "CARDIO", "Mancuernas", 6, 15, 1, MANCUERNA),
    Seed("Box jump", "CARDIO", "Peso corporal", 5, 15, 1, CORPORAL),
    Seed("Wall ball", "CARDIO", "Balon medicinal", 10, 25, 1, BALON),
    Seed("Thruster", "CARDIO", "Barra", 6, 15, 1, BARRA),
    Seed("Air squat", "CARDIO", "Peso corporal", 15, 30, 1, CORPORAL),
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

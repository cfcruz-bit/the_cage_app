"""Limiter compartido. En modulo aparte para que main.py y los routers lo
importen sin depender el uno del otro."""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

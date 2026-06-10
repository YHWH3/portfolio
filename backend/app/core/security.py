import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

from app.config import settings
from app.redis_client import async_redis

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

REFRESH_PREFIX = "refresh:"
PWRESET_PREFIX = "pwreset:"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str) -> str:
    payload = {
        "sub": str(user_id),
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])


async def create_refresh_token(user_id: str) -> str:
    jti = str(uuid.uuid4())
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "jti": jti,
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, settings.JWT_REFRESH_SECRET, algorithm="HS256")
    # Single-use: token is only valid while its jti exists in Redis.
    await async_redis.setex(
        f"{REFRESH_PREFIX}{jti}",
        timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        str(user_id),
    )
    return token


async def consume_refresh_token(token: str) -> str | None:
    """Validate a refresh token, invalidate it (rotation), return the user id."""
    try:
        payload = jwt.decode(token, settings.JWT_REFRESH_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "refresh":
        return None
    jti = payload.get("jti")
    if not jti:
        return None
    key = f"{REFRESH_PREFIX}{jti}"
    user_id = await async_redis.get(key)
    if user_id is None:
        return None
    await async_redis.delete(key)
    return user_id


async def create_password_reset_token(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await async_redis.setex(f"{PWRESET_PREFIX}{token}", timedelta(hours=1), str(user_id))
    return token


async def consume_password_reset_token(token: str) -> str | None:
    key = f"{PWRESET_PREFIX}{token}"
    user_id = await async_redis.get(key)
    if user_id is not None:
        await async_redis.delete(key)
    return user_id

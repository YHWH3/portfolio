from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://copilot_user:copilot@localhost:5432/copilot_db"
    REDIS_URL: str = "redis://localhost:6379/0"

    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_SONNET_MODEL: str = "claude-sonnet-4-20250514"
    ANTHROPIC_HAIKU_MODEL: str = "claude-haiku-4-5-20251001"
    VOYAGE_API_KEY: str = ""
    EMBEDDING_DIM: int = 1024

    JWT_SECRET: str = "dev-jwt-secret"
    JWT_REFRESH_SECRET: str = "dev-jwt-refresh-secret"
    ENCRYPTION_KEY: str = "dev-encryption-key"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    UPLOAD_DIR: str = "./uploads"

    CORS_ORIGINS: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"

    @property
    def sync_database_url(self) -> str:
        return self.DATABASE_URL.replace("+asyncpg", "+psycopg2")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

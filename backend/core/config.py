from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://trader:changeme@postgres:5432/kalshi_trader"
    redis_url: str = "redis://redis:6379"
    kalshi_api_key_id: str = ""
    kalshi_api_key: str = ""
    kalshi_env: str = "demo"  # 'demo' or 'prod'

    @property
    def kalshi_base_url(self) -> str:
        if self.kalshi_env == "prod":
            return "https://trading.kalshi.com/trade-api/v2"
        return "https://demo-api.kalshi.co/trade-api/v2"

    class Config:
        env_file = ".env"


settings = Settings()

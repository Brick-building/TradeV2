FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn[standard]==0.29.0 \
    asyncpg==0.29.0 \
    sqlalchemy[asyncio]==2.0.30 \
    redis[asyncio]==5.0.4 \
    httpx==0.27.0 \
    apscheduler==3.10.4 \
    pydantic==2.7.1 \
    pydantic-settings==2.2.1 \
    python-dotenv==1.0.1 \
    cryptography==42.0.7 \
    PyJWT==2.8.0

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.12-slim

WORKDIR /code

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Node.js + Claude Code CLI — lets the app use a Claude subscription
# (AI_PROVIDER=claude_cli with CLAUDE_CODE_OAUTH_TOKEN) instead of an API key.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

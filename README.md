# Birria Fusion Ops Production AI

This is the real long-term foundation build.

It includes:

- React + Vite frontend
- Express backend
- PostgreSQL central storage
- Pure JS `pg` database client
- No SQLite / no better-sqlite3 / no native SQLite GLIBC issue
- JWT login/auth
- Responsive desktop/tablet/mobile layout
- Operations Today dashboard
- Inventory, menu, catering, events, staff, equipment, suppliers, tasks, playbook
- AI Copilot API with Ollama hooks
- Rules-based fallback when `AI_ENABLED=false`

## Fresh LXC Install

```bash
cd /home/chancesr
rm -rf birria-fusion-ops
unzip birria-fusion-ops-production-ai.zip -d birria-fusion-ops
cd birria-fusion-ops
cp .env.example .env
./install.sh
PORT=5000 npm start
```

Open:

```text
http://192.168.0.60:5000
```

Default login:

```text
admin
admin123
```

## AI / Ollama

By default the AI page uses rules-based recommendations.

To enable real Ollama:

```env
AI_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

Then restart the server.

## Claude Code

Tell Claude to follow `CLAUDE_CODE_INSTALL.md` exactly.

# CLAUDE CODE INSTALL INSTRUCTIONS

Do not improvise. Do not use old phase files.

```bash
cd /home/chancesr
rm -rf birria-fusion-ops
unzip -o birria-fusion-ops-production-ai.zip -d birria-fusion-ops
cd birria-fusion-ops
cp .env.example .env
./install.sh
PORT=5000 nohup npm start > app.log 2>&1 &
```

Test:

```bash
curl http://localhost:5000/api/public-health
curl -I http://localhost:5000
```

Expected:

```text
HTTP/1.1 200 OK
```

Open:

```text
http://192.168.0.60:5000
```

Login:

```text
admin
admin123
```

Do not install SQLite. Do not install better-sqlite3. Do not edit node_modules.

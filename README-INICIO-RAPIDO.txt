CONCILIO WANTED BOT v0.2.1 - RAILWAY SAFE

1) Copia tu .env local si vas a probar en Windows. NO lo subas a GitHub.
2) npm.cmd install
3) npm.cmd run deploy  (solo si necesitas volver a registrar /sentenciar)
4) npm.cmd start

RAILWAY:
- Variables: las mismas del .env
- Volume conectado al servicio
- Mount Path: /app/data
- Start Command: npm start

Esta versión NO usa better-sqlite3. Guarda los registros en data/concilio.json.

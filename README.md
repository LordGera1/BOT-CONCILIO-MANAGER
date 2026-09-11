# Concilio WANTED Bot v0.2.1 (Railway Safe)

Versión preparada para Railway sin módulos nativos de SQLite.

## Cambio principal

- Se eliminó `better-sqlite3` para evitar crashes/segmentation faults en contenedores Linux.
- El almacenamiento ahora usa JSON persistente en `data/concilio.json`.
- En Railway, conecta un Volume con Mount Path `/app/data`.
- Si Railway define `RAILWAY_VOLUME_MOUNT_PATH`, el bot lo usa automáticamente.
- `/sentenciar`, detección de cierre, publicación en WANTED y auditoría conservan el mismo flujo.
- Se corrigió la advertencia de `ephemeral` de discord.js usando `MessageFlags.Ephemeral`.

## Railway

Variables necesarias:

- BOT_TOKEN
- CLIENT_ID
- TICKETS_GUILD_ID
- TICKET_LOG_CHANNEL_ID
- STAFF_ROLE_ID
- TICKET_KING_BOT_ID
- ADMIN_GUILD_ID
- WANTED_CHANNEL_ID
- AUDIT_CHANNEL_ID

Volume:

`/app/data`

Start command:

`npm start`

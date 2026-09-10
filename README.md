# Concilio WANTED Bot — MVP 0.1

Bot auxiliar para trabajar junto con Ticket King.

## Qué hace esta primera versión

1. El staff usa `/sentenciar` dentro de un ticket.
2. El bot guarda la sentencia en SQLite con auditoría.
3. El staff cierra el ticket normalmente con Ticket King.
4. El bot escucha el canal de **Closed Tickets / Transcripts** de Ticket King.
5. Cuando encuentra el ticket y su transcript, publica automáticamente la sentencia en `#wanted` del Discord administrativo.
6. El mensaje de WANTED es enviado por el bot, no por el staff.
7. Si el mensaje de WANTED se elimina mientras el bot está conectado, genera una alerta en `#audit-sentencias` y conserva el registro en la base de datos.

## Datos manuales en /sentenciar

- Sentenciado
- Atendido por
- Motivo
- Sanción
- Servidor (S1/S2)

## Datos automáticos

- Número de ticket: se obtiene del nombre del canal.
- Usuario que registró la sentencia.
- Fecha/hora.
- Código WANTED.
- Transcript: se obtiene del log de Ticket King.
- Mensaje final en WANTED.

## 1. Requisitos

- Node.js 20 o superior.
- El mismo bot agregado al Discord de tickets y al Discord administrativo.
- Ticket King configurado para mandar los tickets cerrados/transcripts a un canal concreto.

## 2. Crear el bot

En Discord Developer Portal:

1. Crea una nueva Application.
2. En **Bot**, crea el bot.
3. Activa **Message Content Intent**. Es necesario para poder interpretar correctamente los mensajes/logs que manda Ticket King.
4. Copia el **Application ID / Client ID**.
5. Genera/copía el token únicamente para ponerlo en tu `.env`. **No publiques ni compartas el token.**

Para invitarlo, usa los scopes:

- `bot`
- `applications.commands`

Permisos mínimos recomendados en los canales donde trabajará:

- View Channels
- Send Messages
- Embed Links
- Read Message History

No necesita `Administrator`.

## 3. IDs que necesitas copiar de Discord

Activa Developer Mode en Discord y copia:

- `TICKETS_GUILD_ID`: servidor donde están los tickets.
- `TICKET_LOG_CHANNEL_ID`: canal donde Ticket King publica cierres/transcripts.
- `STAFF_ROLE_ID`: rol autorizado para usar `/sentenciar`.
- `ADMIN_GUILD_ID`: Discord administrativo.
- `WANTED_CHANNEL_ID`: canal privado WANTED.
- `AUDIT_CHANNEL_ID`: canal privado de auditoría.
- `TICKET_KING_BOT_ID`: opcional pero recomendado; ID de Ticket King.

## 4. Configurar

Copia `.env.example` como `.env` y completa los IDs.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

Linux/macOS:

```bash
cp .env.example .env
```

## 5. Instalar y arrancar

```bash
npm install
npm run deploy
npm start
```

`npm run deploy` registra `/sentenciar` únicamente en el servidor de tickets para que aparezca rápidamente durante las pruebas.

## 6. Primera prueba

Dentro de un ticket cuyo nombre contenga su número, por ejemplo `ticket-3890`:

```text
/sentenciar
  sentenciado: @sobrino
  atendido: @JaimeAlberto5
  motivo: RDM
  sancion: 1h 30m
  servidor: S1
```

Después cierra el ticket normalmente con Ticket King.

Cuando Ticket King publique el transcript en `TICKET_LOG_CHANNEL_ID`, el bot intentará identificar `3890` y publicar:

```text
⚖️ SENTENCIA DE TICKET
🎫 Ticket: #3890
👤 Sentenciado: @sobrino
🛡️ Atendido por: @JaimeAlberto5
📋 Motivo: RDM
⏱️ Sanción: 1h 30m
🌐 Servidor: S1
📄 Transcript: Ver ticket
```

## Importante para la siguiente etapa

Ticket King puede cambiar la estructura visual de su mensaje de transcript. El detector de esta versión es deliberadamente flexible, pero para dejarlo 100% adaptado a tu servidor necesitamos hacer una prueba real.

Si `/sentenciar` funciona pero no publica WANTED al cerrar, toma una captura del mensaje exacto que Ticket King manda al canal de logs (incluido botón/link del transcript). Con eso ajustamos el parser sin cambiar el resto del sistema.

## Seguridad recomendada para #wanted

Al rol normal de staff quítale en ese canal:

- Send Messages
- Manage Messages
- Manage Webhooks
- Manage Channel

El bot sí debe tener View Channel + Send Messages + Embed Links + Read Message History.

Los usuarios con permiso global `Administrator` siempre pueden saltarse overwrites de canal. Por eso el bot también conserva las sentencias en SQLite y manda eventos al canal privado de auditoría.

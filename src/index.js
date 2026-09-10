import 'dotenv/config';
import Database from 'better-sqlite3';
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_ENV = [
  'BOT_TOKEN',
  'TICKETS_GUILD_ID',
  'TICKET_LOG_CHANNEL_ID',
  'STAFF_ROLE_ID',
  'ADMIN_GUILD_ID',
  'WANTED_CHANNEL_ID',
  'AUDIT_CHANNEL_ID',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key] || (key === 'BOT_TOKEN' && process.env[key] === 'PEGA_AQUI_TU_TOKEN')) {
    console.error(`❌ Falta ${key} en el archivo .env`);
    process.exit(1);
  }
}

const dataDir = path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'concilio.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_code TEXT UNIQUE,
    ticket_number TEXT NOT NULL,
    ticket_channel_id TEXT NOT NULL UNIQUE,
    source_guild_id TEXT NOT NULL,
    sentenced_user_id TEXT NOT NULL,
    sentenced_user_tag TEXT NOT NULL,
    attended_user_id TEXT NOT NULL,
    attended_user_tag TEXT NOT NULL,
    reason TEXT NOT NULL,
    sanction TEXT NOT NULL,
    server TEXT NOT NULL,
    registered_by_id TEXT NOT NULL,
    registered_by_tag TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    transcript_url TEXT,
    ticket_log_message_id TEXT,
    wanted_message_id TEXT,
    created_at TEXT NOT NULL,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence_id INTEGER,
    action TEXT NOT NULL,
    actor_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(sentence_id) REFERENCES sentences(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sentences_ticket_number
  ON sentences(ticket_number);

  CREATE INDEX IF NOT EXISTS idx_sentences_wanted_message_id
  ON sentences(wanted_message_id);
`);

const insertSentence = db.prepare(`
  INSERT INTO sentences (
    record_code, ticket_number, ticket_channel_id, source_guild_id,
    sentenced_user_id, sentenced_user_tag,
    attended_user_id, attended_user_tag,
    reason, sanction, server,
    registered_by_id, registered_by_tag,
    status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
`);

const getByTicketChannel = db.prepare(
  'SELECT * FROM sentences WHERE ticket_channel_id = ?',
);
const getPending = db.prepare(
  "SELECT * FROM sentences WHERE status = 'pending' ORDER BY id DESC LIMIT 500",
);
const getByWantedMessage = db.prepare(
  'SELECT * FROM sentences WHERE wanted_message_id = ?',
);
const markPublished = db.prepare(`
  UPDATE sentences
  SET status = 'published', transcript_url = ?, ticket_log_message_id = ?,
      wanted_message_id = ?, published_at = ?
  WHERE id = ?
`);
const insertAudit = db.prepare(`
  INSERT INTO audit_log (sentence_id, action, actor_id, details, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

function nowIso() {
  return new Date().toISOString();
}

function displayTag(user) {
  return user.globalName || user.username || user.tag || user.id;
}

function extractTicketNumber(channelName) {
  const matches = String(channelName || '').match(/\d+/g);
  return matches?.length ? matches[matches.length - 1] : null;
}

function buildRecordCode(ticketNumber, rowId) {
  const numeric = String(ticketNumber || '').replace(/\D/g, '');
  if (numeric) return `W-${numeric.padStart(6, '0')}`;
  return `W-${String(rowId).padStart(6, '0')}`;
}

function flattenMessage(message) {
  const parts = [message.content || ''];

  for (const embed of message.embeds || []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    if (embed.url) parts.push(embed.url);
    if (embed.footer?.text) parts.push(embed.footer.text);
    for (const field of embed.fields || []) {
      parts.push(field.name || '', field.value || '');
    }
  }

  for (const row of message.components || []) {
    for (const component of row.components || []) {
      if (component.label) parts.push(component.label);
      if (component.url) parts.push(component.url);
    }
  }

  for (const attachment of message.attachments?.values?.() || []) {
    parts.push(attachment.name || '', attachment.url || '');
  }

  return parts.filter(Boolean).join('\n');
}

function extractUrls(message) {
  const urls = new Set();
  const addFromText = (text) => {
    for (const match of String(text || '').matchAll(/https?:\/\/[^\s)>\]}]+/g)) {
      urls.add(match[0]);
    }
  };

  addFromText(message.content);
  for (const embed of message.embeds || []) {
    addFromText(embed.url);
    addFromText(embed.description);
    for (const field of embed.fields || []) addFromText(field.value);
  }
  for (const row of message.components || []) {
    for (const component of row.components || []) addFromText(component.url);
  }
  for (const attachment of message.attachments?.values?.() || []) {
    addFromText(attachment.url);
  }

  return [...urls];
}

function pickTranscriptUrl(message, searchableText) {
  const urls = extractUrls(message);
  if (!urls.length) return null;

  // Prioriza URLs que parecen transcript/ticket.
  const preferred = urls.find((url) =>
    /transcript|ticket|logs?|html/i.test(url),
  );
  if (preferred) return preferred;

  // Si el mensaje indica claramente transcript/cierre, acepta la primera URL.
  if (/transcript|closed|close|cerrad[oa]|ticket/i.test(searchableText)) {
    return urls[0];
  }
  return null;
}

function memberCanSentence(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (roles.cache) return roles.cache.has(process.env.STAFF_ROLE_ID);
  if (Array.isArray(roles)) return roles.includes(process.env.STAFF_ROLE_ID);
  return false;
}

async function sendAudit(embed) {
  try {
    const channel = await client.channels.fetch(process.env.AUDIT_CHANNEL_ID);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('No se pudo mandar al canal de auditoría:', error);
  }
}

async function publishSentence(row, transcriptUrl, ticketLogMessageId) {
  const wantedChannel = await client.channels.fetch(process.env.WANTED_CHANNEL_ID);
  if (!wantedChannel?.isTextBased()) {
    throw new Error('WANTED_CHANNEL_ID no apunta a un canal de texto.');
  }

  const embed = new EmbedBuilder()
    .setTitle('⚖️ SENTENCIA DE TICKET')
    .addFields(
      { name: '🎫 Ticket', value: `#${row.ticket_number}`, inline: true },
      { name: '👤 Sentenciado', value: `<@${row.sentenced_user_id}>`, inline: true },
      { name: '🛡️ Atendido por', value: `<@${row.attended_user_id}>`, inline: true },
      { name: '📋 Motivo', value: row.reason, inline: false },
      { name: '⏱️ Sanción', value: row.sanction, inline: true },
      { name: '🌐 Servidor', value: row.server, inline: true },
      { name: '📄 Transcript', value: `[Ver ticket](${transcriptUrl})`, inline: false },
    )
    .setFooter({ text: `${row.record_code} • Registro automático` })
    .setTimestamp(new Date(row.created_at));

  const wantedMessage = await wantedChannel.send({ embeds: [embed] });
  const publishedAt = nowIso();

  markPublished.run(
    transcriptUrl,
    ticketLogMessageId,
    wantedMessage.id,
    publishedAt,
    row.id,
  );

  insertAudit.run(
    row.id,
    'PUBLISHED',
    client.user.id,
    JSON.stringify({
      record_code: row.record_code,
      ticket_number: row.ticket_number,
      wanted_message_id: wantedMessage.id,
      registered_by_id: row.registered_by_id,
      registered_by_tag: row.registered_by_tag,
    }),
    publishedAt,
  );

  await sendAudit(
    new EmbedBuilder()
      .setTitle('✅ Sentencia publicada')
      .setDescription(
        `**${row.record_code}** · Ticket **#${row.ticket_number}**\n` +
          `Registrado originalmente por <@${row.registered_by_id}> (${row.registered_by_tag}).`,
      )
      .addFields(
        { name: 'Sentenciado', value: `<@${row.sentenced_user_id}>`, inline: true },
        { name: 'Sanción', value: row.sanction, inline: true },
        { name: 'Servidor', value: row.server, inline: true },
      )
      .setTimestamp(),
  );

  console.log(`✅ Publicado ${row.record_code} para ticket #${row.ticket_number}`);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Bot conectado como ${readyClient.user.tag}`);

  const checks = [
    ['Servidor de tickets', process.env.TICKETS_GUILD_ID, 'guild'],
    ['Servidor administrativo', process.env.ADMIN_GUILD_ID, 'guild'],
    ['Logs Ticket King', process.env.TICKET_LOG_CHANNEL_ID, 'channel'],
    ['WANTED', process.env.WANTED_CHANNEL_ID, 'channel'],
    ['Auditoría', process.env.AUDIT_CHANNEL_ID, 'channel'],
  ];

  for (const [label, id, type] of checks) {
    try {
      if (type === 'guild') {
        const guild = await readyClient.guilds.fetch(id);
        console.log(`✅ ${label}: ${guild.name} (${id})`);
      } else {
        const channel = await readyClient.channels.fetch(id);
        console.log(`✅ ${label}: #${channel?.name || 'canal'} (${id})`);
      }
    } catch {
      console.log(`❌ No puedo acceder a ${label} (${id}). Revisa que el bot esté dentro del servidor y tenga permiso View Channel.`);
    }
  }

  console.log('Esperando /sentenciar y cierres de Ticket King...');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'sentenciar') {
    return;
  }

  try {
    if (interaction.guildId !== process.env.TICKETS_GUILD_ID) {
      return interaction.reply({
        content: '❌ Este comando solo funciona en el servidor de tickets.',
        ephemeral: true,
      });
    }

    if (!memberCanSentence(interaction)) {
      return interaction.reply({
        content: '❌ No tienes el rol autorizado para registrar sentencias.',
        ephemeral: true,
      });
    }

    const ticketNumber = extractTicketNumber(interaction.channel?.name);
    if (!ticketNumber) {
      return interaction.reply({
        content:
          '❌ No pude detectar el número del ticket en el nombre de este canal. ' +
          'Ejemplo esperado: `ticket-3890` o `reporte-3890`.',
        ephemeral: true,
      });
    }

    const existing = getByTicketChannel.get(interaction.channelId);
    if (existing) {
      return interaction.reply({
        content:
          `⚠️ Este ticket ya tiene una sentencia registrada: **${existing.record_code}** ` +
          `(${existing.status}). No crearé una segunda automáticamente.`,
        ephemeral: true,
      });
    }

    const sentenced = interaction.options.getUser('sentenciado', true);
    const attended = interaction.options.getUser('atendido', true);
    const reason = interaction.options.getString('motivo', true).trim();
    const sanction = interaction.options.getString('sancion', true).trim();
    const server = interaction.options.getString('servidor', true);

    const createdAt = nowIso();

    // Primero se crea con un código temporal para obtener el ID.
    const tempCode = `TEMP-${interaction.channelId}`;
    const result = insertSentence.run(
      tempCode,
      ticketNumber,
      interaction.channelId,
      interaction.guildId,
      sentenced.id,
      displayTag(sentenced),
      attended.id,
      displayTag(attended),
      reason,
      sanction,
      server,
      interaction.user.id,
      displayTag(interaction.user),
      createdAt,
    );

    const recordCode = buildRecordCode(ticketNumber, result.lastInsertRowid);
    db.prepare('UPDATE sentences SET record_code = ? WHERE id = ?').run(
      recordCode,
      result.lastInsertRowid,
    );

    insertAudit.run(
      result.lastInsertRowid,
      'REGISTERED',
      interaction.user.id,
      JSON.stringify({
        record_code: recordCode,
        ticket_number: ticketNumber,
        sentenced_user_id: sentenced.id,
        attended_user_id: attended.id,
        reason,
        sanction,
        server,
      }),
      createdAt,
    );

    await interaction.reply({
      content:
        `✅ **Sentencia registrada: ${recordCode}**\n` +
        `🎫 Ticket: **#${ticketNumber}**\n` +
        `👤 Sentenciado: ${sentenced}\n` +
        `🛡️ Atendido por: ${attended}\n` +
        `📋 Motivo: **${reason}**\n` +
        `⏱️ Sanción: **${sanction}**\n` +
        `🌐 Servidor: **${server}**\n\n` +
        'Ahora cierra el ticket normalmente con Ticket King. Cuando aparezca el transcript en el canal de logs, lo publicaré automáticamente en WANTED.',
      ephemeral: true,
    });

    await sendAudit(
      new EmbedBuilder()
        .setTitle('📝 Sentencia pendiente registrada')
        .setDescription(`**${recordCode}** · Ticket **#${ticketNumber}**`)
        .addFields(
          { name: 'Sentenciado', value: `${sentenced} (${displayTag(sentenced)})`, inline: true },
          { name: 'Atendido por', value: `${attended} (${displayTag(attended)})`, inline: true },
          { name: 'Registrado por', value: `${interaction.user} (${displayTag(interaction.user)})`, inline: false },
          { name: 'Motivo', value: reason, inline: true },
          { name: 'Sanción', value: sanction, inline: true },
          { name: 'Servidor', value: server, inline: true },
        )
        .setTimestamp(),
    );
  } catch (error) {
    console.error('Error en /sentenciar:', error);
    const content = '❌ Ocurrió un error al registrar la sentencia.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.channelId !== process.env.TICKET_LOG_CHANNEL_ID) return;
    if (!message.author?.bot) return;
    if (
      process.env.TICKET_KING_BOT_ID &&
      message.author.id !== process.env.TICKET_KING_BOT_ID
    ) {
      return;
    }

    const text = flattenMessage(message);
    if (!text) return;

    // Evita reaccionar a mensajes que claramente no parecen cierres/transcripts.
    if (!/transcript|closed|close|cerrad[oa]|ticket/i.test(text)) return;

    const pending = getPending.all();
    const row = pending.find((candidate) => {
      const escaped = candidate.ticket_number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(text);
    });

    if (!row) return;

    const transcriptUrl = pickTranscriptUrl(message, text);
    if (!transcriptUrl) {
      console.log(
        `ℹ️ Detecté cierre del ticket #${row.ticket_number}, pero aún no una URL de transcript. Esperando otro mensaje...`,
      );
      return;
    }

    await publishSentence(row, transcriptUrl, message.id);
  } catch (error) {
    console.error('Error procesando log de Ticket King:', error);
  }
});

client.on(Events.MessageDelete, async (message) => {
  try {
    if (message.channelId !== process.env.WANTED_CHANNEL_ID) return;

    const row = getByWantedMessage.get(message.id);
    if (!row) return;

    insertAudit.run(
      row.id,
      'WANTED_MESSAGE_DELETED',
      null,
      JSON.stringify({ wanted_message_id: message.id }),
      nowIso(),
    );

    await sendAudit(
      new EmbedBuilder()
        .setTitle('🚨 ALERTA DE INTEGRIDAD')
        .setDescription(
          `El mensaje de **${row.record_code}** fue eliminado de WANTED.\n` +
            `La sentencia **permanece guardada en la base de datos**.`,
        )
        .addFields(
          { name: 'Ticket', value: `#${row.ticket_number}`, inline: true },
          { name: 'Sentenciado', value: `<@${row.sentenced_user_id}>`, inline: true },
          { name: 'Sanción', value: row.sanction, inline: true },
          { name: 'Registrado por', value: `<@${row.registered_by_id}>`, inline: false },
        )
        .setTimestamp(),
    );
  } catch (error) {
    console.error('Error registrando eliminación de WANTED:', error);
  }
});

client.login(process.env.BOT_TOKEN);

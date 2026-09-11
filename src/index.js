import 'dotenv/config';
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
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
    console.error(`❌ Falta ${key} en las variables de entorno.`);
    process.exit(1);
  }
}

// Railway expone RAILWAY_VOLUME_MOUNT_PATH cuando hay un volumen conectado.
// En local, usamos ./data.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve('data');

fs.mkdirSync(dataDir, { recursive: true });
const storePath = path.join(dataDir, 'concilio.json');
const tempStorePath = `${storePath}.tmp`;

function emptyStore() {
  return {
    version: 1,
    nextSentenceId: 1,
    nextAuditId: 1,
    sentences: [],
    audit_log: [],
  };
}

function loadStore() {
  if (!fs.existsSync(storePath)) {
    const initial = emptyStore();
    writeStore(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...emptyStore(),
      ...parsed,
      sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
      audit_log: Array.isArray(parsed.audit_log) ? parsed.audit_log : [],
    };
  } catch (error) {
    console.error(`❌ No pude leer ${storePath}:`, error);
    process.exit(1);
  }
}

function writeStore(nextStore) {
  const json = JSON.stringify(nextStore, null, 2);
  fs.writeFileSync(tempStorePath, json, 'utf8');
  fs.renameSync(tempStorePath, storePath);
}

let store = loadStore();

function persist() {
  writeStore(store);
}

function insertSentence(data) {
  if (store.sentences.some((row) => row.ticket_channel_id === data.ticket_channel_id)) {
    const err = new Error('Este canal ya tiene una sentencia registrada.');
    err.code = 'DUPLICATE_TICKET_CHANNEL';
    throw err;
  }

  const id = store.nextSentenceId++;
  const row = { id, ...data };
  store.sentences.push(row);
  persist();
  return row;
}

function getByTicketChannel(channelId) {
  return store.sentences.find((row) => row.ticket_channel_id === channelId) || null;
}

function getPending() {
  return store.sentences
    .filter((row) => row.status === 'pending')
    .sort((a, b) => b.id - a.id)
    .slice(0, 500);
}

function getByWantedMessage(messageId) {
  return store.sentences.find((row) => row.wanted_message_id === messageId) || null;
}

function updateSentence(id, patch) {
  const index = store.sentences.findIndex((row) => row.id === id);
  if (index < 0) throw new Error(`Sentencia ${id} no encontrada.`);
  store.sentences[index] = { ...store.sentences[index], ...patch };
  persist();
  return store.sentences[index];
}

function insertAudit(sentenceId, action, actorId, details, createdAt) {
  const row = {
    id: store.nextAuditId++,
    sentence_id: sentenceId ?? null,
    action,
    actor_id: actorId ?? null,
    details,
    created_at: createdAt,
  };
  store.audit_log.push(row);
  persist();
  return row;
}

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

  const preferred = urls.find((url) => /transcript|ticket|logs?|html/i.test(url));
  if (preferred) return preferred;

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

  updateSentence(row.id, {
    status: 'published',
    transcript_url: transcriptUrl,
    ticket_log_message_id: ticketLogMessageId,
    wanted_message_id: wantedMessage.id,
    published_at: publishedAt,
  });

  insertAudit(
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
  console.log(`✅ Almacenamiento persistente: ${storePath}`);

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

  const ephemeral = MessageFlags.Ephemeral;

  try {
    if (interaction.guildId !== process.env.TICKETS_GUILD_ID) {
      return interaction.reply({
        content: '❌ Este comando solo funciona en el servidor de tickets.',
        flags: ephemeral,
      });
    }

    if (!memberCanSentence(interaction)) {
      return interaction.reply({
        content: '❌ No tienes el rol autorizado para registrar sentencias.',
        flags: ephemeral,
      });
    }

    const ticketNumber = extractTicketNumber(interaction.channel?.name);
    if (!ticketNumber) {
      return interaction.reply({
        content:
          '❌ No pude detectar el número del ticket en el nombre de este canal. ' +
          'Ejemplo esperado: `ticket-3890` o `reporte-3890`.',
        flags: ephemeral,
      });
    }

    const existing = getByTicketChannel(interaction.channelId);
    if (existing) {
      return interaction.reply({
        content:
          `⚠️ Este ticket ya tiene una sentencia registrada: **${existing.record_code}** ` +
          `(${existing.status}). No crearé una segunda automáticamente.`,
        flags: ephemeral,
      });
    }

    const sentenced = interaction.options.getUser('sentenciado', true);
    const attended = interaction.options.getUser('atendido', true);
    const reason = interaction.options.getString('motivo', true).trim();
    const sanction = interaction.options.getString('sancion', true).trim();
    const server = interaction.options.getString('servidor', true);
    const createdAt = nowIso();

    const id = store.nextSentenceId;
    const recordCode = buildRecordCode(ticketNumber, id);

    const row = insertSentence({
      record_code: recordCode,
      ticket_number: ticketNumber,
      ticket_channel_id: interaction.channelId,
      source_guild_id: interaction.guildId,
      sentenced_user_id: sentenced.id,
      sentenced_user_tag: displayTag(sentenced),
      attended_user_id: attended.id,
      attended_user_tag: displayTag(attended),
      reason,
      sanction,
      server,
      registered_by_id: interaction.user.id,
      registered_by_tag: displayTag(interaction.user),
      status: 'pending',
      transcript_url: null,
      ticket_log_message_id: null,
      wanted_message_id: null,
      created_at: createdAt,
      published_at: null,
    });

    insertAudit(
      row.id,
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
      flags: ephemeral,
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
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
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
    if (!/transcript|closed|close|cerrad[oa]|ticket/i.test(text)) return;

    const pending = getPending();
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

    const row = getByWantedMessage(message.id);
    if (!row) return;

    insertAudit(
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
            'La sentencia **permanece guardada en la base de datos**.',
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

process.on('uncaughtException', (error) => {
  console.error('❌ uncaughtException:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});

client.login(process.env.BOT_TOKEN);

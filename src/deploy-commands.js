import 'dotenv/config';
import {
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';

const required = ['BOT_TOKEN', 'CLIENT_ID', 'TICKETS_GUILD_ID'];
for (const key of required) {
  if (!process.env[key] || process.env[key] === 'PEGA_AQUI_TU_TOKEN') {
    console.error(`Falta ${key} en .env`);
    process.exit(1);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('sentenciar')
    .setDescription('Registra una sentencia pendiente para el ticket actual.')
    .addUserOption((option) =>
      option
        .setName('sentenciado')
        .setDescription('Jugador que recibirá la sanción.')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('atendido')
        .setDescription('Miembro del staff que atendió el ticket.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('motivo')
        .setDescription('Motivo de la sentencia, por ejemplo RDM.')
        .setMaxLength(150)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('sancion')
        .setDescription('Duración o tipo de sanción, por ejemplo 1h 30m.')
        .setMaxLength(50)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('servidor')
        .setDescription('Servidor donde ocurrió el reporte.')
        .setRequired(true)
        .addChoices(
          { name: 'Servidor 1 (S1)', value: 'S1' },
          { name: 'Servidor 2 (S2)', value: 'S2' },
        ),
    )
    // La autorización real se valida por STAFF_ROLE_ID dentro del bot.
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

try {
  console.log('Registrando /sentenciar en el servidor de tickets...');
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.TICKETS_GUILD_ID,
    ),
    { body: commands },
  );
  console.log('Comando registrado correctamente.');
} catch (error) {
  console.error(error);
  process.exit(1);
}

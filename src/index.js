require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  REST,
  Routes,
  Events
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const WARNINGS_FILE = path.join(__dirname, '..', 'data', 'warnings.json');

if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN. Copia .env.example a .env y configura tu token.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const P = PermissionFlagsBits;

const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Expulsa permanentemente a un miembro del servidor.')
    .setDefaultMemberPermissions(P.BanMembers)
    .addUserOption(o => o.setName('usuario').setDescription('Miembro que se va a bloquear').setRequired(true))
    .addStringOption(o => o.setName('razon').setDescription('Motivo de la sanción').setMaxLength(400))
    .addIntegerOption(o => o.setName('dias').setDescription('Días de mensajes que se borrarán (0 a 7)').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsa a un miembro del servidor.')
    .setDefaultMemberPermissions(P.KickMembers)
    .addUserOption(o => o.setName('usuario').setDescription('Miembro que se va a expulsar').setRequired(true))
    .addStringOption(o => o.setName('razon').setDescription('Motivo de la expulsión').setMaxLength(400)),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Restringe temporalmente a un miembro.')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(o => o.setName('usuario').setDescription('Miembro que se va a restringir').setRequired(true))
    .addIntegerOption(o => o.setName('minutos').setDescription('Duración en minutos (1 a 40320)').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName('razon').setDescription('Motivo de la sanción').setMaxLength(400)),
  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Retira la restricción temporal de un miembro.')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(o => o.setName('usuario').setDescription('Miembro al que se le quitará el timeout').setRequired(true))
    .addStringOption(o => o.setName('razon').setDescription('Motivo').setMaxLength(400)),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Registra una advertencia para un miembro.')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(o => o.setName('usuario').setDescription('Miembro que recibirá la advertencia').setRequired(true))
    .addStringOption(o => o.setName('razon').setDescription('Motivo de la advertencia').setMaxLength(400).setRequired(true)),
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Consulta las advertencias registradas de un miembro.')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(o => o.setName('usuario').setDescription('Miembro cuyas advertencias quieres consultar').setRequired(true)),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Elimina mensajes recientes del canal actual (1 a 100).')
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption(o => o.setName('cantidad').setDescription('Número de mensajes').setMinValue(1).setMaxValue(100).setRequired(true))
    .addStringOption(o => o.setName('razon').setDescription('Motivo de la limpieza').setMaxLength(300)),
  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Configura el modo lento del canal actual.')
    .setDefaultMemberPermissions(P.ManageChannels)
    .addIntegerOption(o => o.setName('segundos').setDescription('Segundos entre mensajes (0 a 21600)').setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Bloquea el envío de mensajes para @everyone en el canal actual.')
    .setDefaultMemberPermissions(P.ManageChannels)
    .addStringOption(o => o.setName('razon').setDescription('Motivo del bloqueo').setMaxLength(300)),
  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Permite de nuevo que @everyone escriba en el canal actual.')
    .setDefaultMemberPermissions(P.ManageChannels)
    .addStringOption(o => o.setName('razon').setDescription('Motivo del desbloqueo').setMaxLength(300)),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Retira el bloqueo de un usuario usando su ID de Discord.')
    .setDefaultMemberPermissions(P.BanMembers)
    .addStringOption(o => o.setName('id').setDescription('ID numérico del usuario').setRequired(true))
    .addStringOption(o => o.setName('razon').setDescription('Motivo del desbloqueo').setMaxLength(300)),
  new SlashCommandBuilder()
    .setName('templanes')
    .setDescription('Crea la estructura de una comunidad: roles, categorías y canales.')
    .setDefaultMemberPermissions(P.ManageGuild),
  new SlashCommandBuilder()
    .setName('templates')
    .setDescription('Alias de /templanes: crea la estructura de una comunidad.')
    .setDefaultMemberPermissions(P.ManageGuild)
].map(command => command.toJSON());

function getReason(interaction) {
  return interaction.options.getString('razon') || 'Sin motivo especificado';
}

async function getTargetMember(interaction) {
  const user = interaction.options.getUser('usuario', true);
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

async function moderationGuard(interaction, target) {
  const guild = interaction.guild;
  if (!guild || !target) return 'No pude encontrar a ese miembro dentro del servidor.';
  if (target.id === interaction.user.id) return 'No puedes aplicar esta acción sobre ti mismo.';
  if (target.id === client.user.id) return 'No puedes aplicar esta acción al bot.';
  if (target.id === guild.ownerId) return 'No se puede moderar al propietario del servidor.';

  const actor = await guild.members.fetch(interaction.user.id).catch(() => null);
  const botMember = await guild.members.fetchMe().catch(() => null);
  if (!actor || !botMember) return 'No pude verificar la jerarquía de roles.';
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    return 'No puedo moderar a ese miembro: su rol más alto está al mismo nivel o por encima del rol del bot. Sube el rol del bot en Ajustes del servidor.';
  }
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    return 'No puedes moderar a ese miembro porque su rol más alto está al mismo nivel o por encima del tuyo.';
  }
  return null;
}

async function logModeration(guild, title, actor, target, reason, extra) {
  const logChannel = guild.channels.cache.find(channel =>
    channel.isTextBased() && channel.name.toLowerCase().includes('mod-logs')
  );
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0xE11D2E)
    .setTitle(title)
    .addFields(
      { name: 'Moderador', value: actor.tag + ' (' + actor.id + ')', inline: false },
      { name: 'Usuario', value: target.tag + ' (' + target.id + ')', inline: false },
      { name: 'Motivo', value: String(reason || 'Sin motivo especificado').slice(0, 1024), inline: false }
    )
    .setTimestamp()
    .setFooter({ text: 'Patoo • Registro de moderación' });

  if (extra) embed.addFields({ name: 'Detalles', value: String(extra).slice(0, 1024), inline: false });
  await logChannel.send({ embeds: [embed] }).catch(() => null);
}

function loadWarnings() {
  try {
    if (!fs.existsSync(WARNINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
  } catch (error) {
    console.error('No se pudo leer warnings.json:', error.message);
    return {};
  }
}

function saveWarnings(data) {
  fs.mkdirSync(path.dirname(WARNINGS_FILE), { recursive: true });
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function handleModeration(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Este comando solo se puede usar dentro de un servidor.', ephemeral: true });
    return;
  }

  const name = interaction.commandName;
  const reason = getReason(interaction);

  if (name === 'ban' || name === 'kick' || name === 'timeout' || name === 'untimeout' || name === 'warn' || name === 'warnings') {
    const target = await getTargetMember(interaction);
    if (name === 'warnings') {
      if (!target) {
        await interaction.reply({ content: 'Ese usuario no es miembro de este servidor.', ephemeral: true });
        return;
      }
      const data = loadWarnings();
      const entries = ((data[guild.id] || {})[target.id] || []);
      if (!entries.length) {
        await interaction.reply({ content: '✅ ' + target.user.tag + ' no tiene advertencias registradas.', ephemeral: true });
        return;
      }
      const list = entries.slice(-10).map((entry, index) =>
        (Math.max(1, entries.length - Math.min(entries.length, 10) + index + 1)) + '. ' +
        String(entry.reason || 'Sin motivo') + ' — ' + new Date(entry.date).toLocaleString('es-ES') +
        ' (por ' + String(entry.moderatorTag || 'desconocido') + ')'
      );
      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('Advertencias de ' + target.user.tag)
        .setDescription(list.join('\n').slice(0, 4000))
        .setFooter({ text: 'Total de advertencias: ' + entries.length });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (!target) {
      await interaction.reply({ content: 'Ese usuario no es miembro de este servidor.', ephemeral: true });
      return;
    }
    const guardMessage = await moderationGuard(interaction, target);
    if (guardMessage) {
      await interaction.reply({ content: '⛔ ' + guardMessage, ephemeral: true });
      return;
    }

    if (name === 'ban') {
      const days = interaction.options.getInteger('dias') || 0;
      await target.ban({ reason: reason, deleteMessageSeconds: days * 86400 });
      await logModeration(guild, 'Usuario bloqueado', interaction.user, target.user, reason, 'Mensajes eliminados: ' + days + ' día(s)');
      await interaction.reply({ content: '🔨 ' + target.user.tag + ' fue bloqueado del servidor. Motivo: ' + reason, ephemeral: true });
      return;
    }

    if (name === 'kick') {
      await target.kick(reason);
      await logModeration(guild, 'Usuario expulsado', interaction.user, target.user, reason);
      await interaction.reply({ content: '👢 ' + target.user.tag + ' fue expulsado del servidor. Motivo: ' + reason, ephemeral: true });
      return;
    }

    if (name === 'timeout') {
      const minutes = interaction.options.getInteger('minutos', true);
      await target.timeout(minutes * 60 * 1000, reason);
      await logModeration(guild, 'Timeout aplicado', interaction.user, target.user, reason, 'Duración: ' + minutes + ' minuto(s)');
      await interaction.reply({ content: '🔇 ' + target.user.tag + ' recibió un timeout de ' + minutes + ' minuto(s).', ephemeral: true });
      return;
    }

    if (name === 'untimeout') {
      await target.timeout(null, reason);
      await logModeration(guild, 'Timeout retirado', interaction.user, target.user, reason);
      await interaction.reply({ content: '✅ Se retiró el timeout de ' + target.user.tag + '.', ephemeral: true });
      return;
    }

    if (name === 'warn') {
      const warningReason = interaction.options.getString('razon', true);
      const data = loadWarnings();
      if (!data[guild.id]) data[guild.id] = {};
      if (!data[guild.id][target.id]) data[guild.id][target.id] = [];
      data[guild.id][target.id].push({
        reason: warningReason,
        date: new Date().toISOString(),
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag
      });
      saveWarnings(data);
      await target.send('⚠️ Recibiste una advertencia en **' + guild.name + '**. Motivo: ' + warningReason).catch(() => null);
      await logModeration(guild, 'Advertencia registrada', interaction.user, target.user, warningReason, 'Total registrado: ' + data[guild.id][target.id].length);
      await interaction.reply({ content: '⚠️ Advertencia registrada para ' + target.user.tag + '. Total: ' + data[guild.id][target.id].length + '.', ephemeral: true });
      return;
    }
  }

  if (name === 'clear') {
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || typeof channel.bulkDelete !== 'function') {
      await interaction.reply({ content: 'Usa este comando en un canal de texto compatible.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getInteger('cantidad', true);
    const deleted = await channel.bulkDelete(amount, true);
    await logModeration(guild, 'Mensajes eliminados', interaction.user, interaction.user, getReason(interaction), 'Mensajes eliminados: ' + deleted.size);
    await interaction.editReply('🧹 Se eliminaron ' + deleted.size + ' mensaje(s). Discord no permite borrar mensajes de más de 14 días mediante borrado masivo.');
    return;
  }

  if (name === 'slowmode') {
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || typeof channel.setRateLimitPerUser !== 'function') {
      await interaction.reply({ content: 'Este comando requiere un canal de texto compatible.', ephemeral: true });
      return;
    }
    const seconds = interaction.options.getInteger('segundos', true);
    await channel.setRateLimitPerUser(seconds, 'Configurado por ' + interaction.user.tag);
    await logModeration(guild, 'Modo lento actualizado', interaction.user, interaction.user, 'Configuración de canal', 'Canal: ' + channel.name + ' | Segundos: ' + seconds);
    await interaction.reply({ content: seconds === 0 ? '✅ Modo lento desactivado.' : '🐢 Modo lento configurado a ' + seconds + ' segundo(s).', ephemeral: true });
    return;
  }

  if (name === 'lock' || name === 'unlock') {
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !channel.permissionOverwrites) {
      await interaction.reply({ content: 'Usa este comando en un canal de texto compatible.', ephemeral: true });
      return;
    }
    const lock = name === 'lock';
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: lock ? false : null
    }, { reason: reason });
    await logModeration(guild, lock ? 'Canal bloqueado' : 'Canal desbloqueado', interaction.user, interaction.user, reason, 'Canal: ' + channel.name);
    await interaction.reply({ content: lock ? '🔒 Canal bloqueado para @everyone.' : '🔓 Se retiró el bloqueo de escritura de @everyone.', ephemeral: true });
    return;
  }

  if (name === 'unban') {
    const id = interaction.options.getString('id', true).trim();
    if (!/^\d{17,20}$/.test(id)) {
      await interaction.reply({ content: 'Introduce un ID de Discord válido, compuesto solo por números.', ephemeral: true });
      return;
    }
    const user = await client.users.fetch(id).catch(() => null);
    if (!user) {
      await interaction.reply({ content: 'No pude encontrar ese usuario de Discord.', ephemeral: true });
      return;
    }
    await guild.bans.remove(id, reason);
    await logModeration(guild, 'Bloqueo retirado', interaction.user, user, reason);
    await interaction.reply({ content: '✅ Se retiró el bloqueo de ' + user.tag + '.', ephemeral: true });
  }
}

function addRoleOverwrite(list, roles, key, allow, deny) {
  if (!roles[key]) return;
  list.push({ id: roles[key].id, allow: allow || [], deny: deny || [] });
}

async function createCommunityTemplate(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Este comando solo se puede usar dentro de un servidor.', ephemeral: true });
    return;
  }

  const botMember = await guild.members.fetchMe().catch(() => null);
  if (!botMember || !botMember.permissions.has([P.ManageRoles, P.ManageChannels])) {
    await interaction.reply({
      content: 'El bot necesita los permisos **Gestionar roles** y **Gestionar canales**. Revisa también que su rol esté por encima de los roles que debe administrar.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const roleDefinitions = [
    { key: 'founder', name: '👑・Fundador', color: '#F1C40F', permissions: [], hoist: true },
    { key: 'admin', name: '🛡️・Administrador', color: '#E74C3C', permissions: [P.ManageGuild, P.ManageChannels, P.ManageRoles, P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog, P.ManageNicknames], hoist: true },
    { key: 'moderator', name: '🔨・Moderador', color: '#E67E22', permissions: [P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog], hoist: true },
    { key: 'support', name: '🧰・Soporte', color: '#3498DB', permissions: [], hoist: true },
    { key: 'events', name: '🎉・Eventos', color: '#9B59B6', permissions: [P.ManageEvents], hoist: true },
    { key: 'creator', name: '🎥・Creador', color: '#1ABC9C', permissions: [], hoist: true },
    { key: 'partner', name: '🤝・Partner', color: '#2ECC71', permissions: [], hoist: true },
    { key: 'booster', name: '💖・Booster', color: '#FF73FA', permissions: [], hoist: true },
    { key: 'vip', name: '💎・VIP', color: '#F39C12', permissions: [], hoist: true },
    { key: 'member', name: '✅・Miembro', color: '#5865F2', permissions: [], hoist: true },
    { key: 'newcomer', name: '🆕・Nuevo', color: '#95A5A6', permissions: [], hoist: false },
    { key: 'muted', name: '🔇・Silenciado', color: '#2C2F33', permissions: [], hoist: false },
    { key: 'bot', name: '🤖・Bot', color: '#7289DA', permissions: [], hoist: false }
  ];

  const roles = {};
  const errors = [];
  let rolesCreated = 0;
  let rolesExisting = 0;

  for (const definition of roleDefinitions) {
    const existing = guild.roles.cache.find(role => role.name === definition.name);
    if (existing) {
      roles[definition.key] = existing;
      rolesExisting++;
      continue;
    }
    try {
      const created = await guild.roles.create({
        name: definition.name,
        color: definition.color,
        permissions: definition.permissions,
        hoist: definition.hoist,
        mentionable: false,
        reason: 'Plantilla de comunidad de Patoo'
      });
      roles[definition.key] = created;
      rolesCreated++;
    } catch (error) {
      errors.push('Rol ' + definition.name + ': ' + error.message);
    }
  }

  const everyoneId = guild.roles.everyone.id;
  const muteDeny = [P.SendMessages, P.AddReactions, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads, P.Connect, P.Speak];

  const publicText = [{ id: everyoneId, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.AddReactions] }];
  addRoleOverwrite(publicText, roles, 'muted', [], muteDeny);

  const publicVoice = [{ id: everyoneId, allow: [P.ViewChannel, P.Connect, P.Speak] }];
  addRoleOverwrite(publicVoice, roles, 'muted', [], [P.Connect, P.Speak]);

  const staffVoice = [{ id: everyoneId, deny: [P.ViewChannel], allow: [] }];
  for (const key of ['founder', 'admin', 'moderator', 'support']) {
    addRoleOverwrite(staffVoice, roles, key, [P.ViewChannel, P.Connect, P.Speak], []);
  }
  staffVoice.push({ id: botMember.id, allow: [P.ViewChannel, P.Connect, P.Speak], deny: [] });

  const readOnly = [{
    id: everyoneId,
    allow: [P.ViewChannel, P.ReadMessageHistory],
    deny: [P.SendMessages, P.AddReactions, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads]
  }];
  for (const key of ['founder', 'admin', 'moderator', 'events']) {
    addRoleOverwrite(readOnly, roles, key, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.AddReactions], []);
  }
  readOnly.push({
    id: botMember.id,
    allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles],
    deny: []
  });
  addRoleOverwrite(readOnly, roles, 'muted', [], muteDeny);

  const staffBase = [{ id: everyoneId, deny: [P.ViewChannel], allow: [] }];
  for (const key of ['founder', 'admin', 'moderator', 'support']) {
    addRoleOverwrite(staffBase, roles, key, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages], []);
  }
  staffBase.push({ id: botMember.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles], deny: [] });

  const modLogs = [{ id: everyoneId, deny: [P.ViewChannel], allow: [] }];
  for (const key of ['founder', 'admin', 'moderator']) {
    addRoleOverwrite(modLogs, roles, key, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages], []);
  }
  modLogs.push({ id: botMember.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles], deny: [] });

  const categoryDefinitions = [
    { key: 'info', name: '📌・INFORMACIÓN', overwrites: readOnly },
    { key: 'community', name: '🌐・COMUNIDAD', overwrites: publicText },
    { key: 'gaming', name: '🎮・JUEGOS', overwrites: publicText },
    { key: 'events', name: '🎉・EVENTOS', overwrites: publicText },
    { key: 'help', name: '🆘・AYUDA', overwrites: publicText },
    { key: 'staff', name: '🔒・STAFF', overwrites: staffBase },
    { key: 'extras', name: '✨・EXTRAS', overwrites: publicText }
  ];

  const categories = {};
  let categoriesCreated = 0;
  let categoriesExisting = 0;

  for (const definition of categoryDefinitions) {
    const existing = guild.channels.cache.find(channel =>
      channel.type === ChannelType.GuildCategory && channel.name === definition.name
    );
    if (existing) {
      categories[definition.key] = existing;
      categoriesExisting++;
      continue;
    }
    try {
      const category = await guild.channels.create({
        name: definition.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: definition.overwrites,
        reason: 'Plantilla de comunidad de Patoo'
      });
      categories[definition.key] = category;
      categoriesCreated++;
    } catch (error) {
      errors.push('Categoría ' + definition.name + ': ' + error.message);
    }
  }

  const channelDefinitions = [
    { category: 'info', name: '👋・bienvenida', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'info', name: '📜・reglas', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'info', name: '📢・anuncios', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'info', name: '🆕・actualizaciones', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'info', name: '❓・faq', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'info', name: '🎭・roles', type: ChannelType.GuildText, overwrites: readOnly },

    { category: 'community', name: '💬・chat-general', type: ChannelType.GuildText },
    { category: 'community', name: '👋・presentaciones', type: ChannelType.GuildText },
    { category: 'community', name: '🖼️・multimedia', type: ChannelType.GuildText },
    { category: 'community', name: '😂・memes', type: ChannelType.GuildText },
    { category: 'community', name: '💡・sugerencias', type: ChannelType.GuildText },
    { category: 'community', name: '🔊・Sala general', type: ChannelType.GuildVoice },
    { category: 'community', name: '🎙️・Sala 1', type: ChannelType.GuildVoice },

    { category: 'gaming', name: '🎮・chat-gaming', type: ChannelType.GuildText },
    { category: 'gaming', name: '🔎・busca-equipo', type: ChannelType.GuildText },
    { category: 'gaming', name: '🎬・clips', type: ChannelType.GuildText },
    { category: 'gaming', name: '🎧・Gaming 1', type: ChannelType.GuildVoice },
    { category: 'gaming', name: '🏆・Ranked', type: ChannelType.GuildVoice },

    { category: 'events', name: '📅・eventos', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'events', name: '🎁・sorteos', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'events', name: '🏆・resultados', type: ChannelType.GuildText, overwrites: readOnly },
    { category: 'events', name: '🙋・participaciones', type: ChannelType.GuildText },

    { category: 'help', name: '🆘・ayuda', type: ChannelType.GuildText },
    { category: 'help', name: '❔・dudas', type: ChannelType.GuildText },
    { category: 'help', name: '💌・contactar-staff', type: ChannelType.GuildText },

    { category: 'staff', name: '🗨️・staff-chat', type: ChannelType.GuildText, overwrites: staffBase },
    { category: 'staff', name: '📣・staff-anuncios', type: ChannelType.GuildText, overwrites: staffBase },
    { category: 'staff', name: '🛡️・mod-logs', type: ChannelType.GuildText, overwrites: modLogs },
    { category: 'staff', name: '🚩・reportes-staff', type: ChannelType.GuildText, overwrites: staffBase },
    { category: 'staff', name: '🔊・Sala staff', type: ChannelType.GuildVoice, overwrites: staffBase },

    { category: 'extras', name: '🤝・alianzas', type: ChannelType.GuildText },
    { category: 'extras', name: '📊・encuestas', type: ChannelType.GuildText },
    { category: 'extras', name: '📌・ideas', type: ChannelType.GuildText }
  ];

  let channelsCreated = 0;
  let channelsExisting = 0;

  for (const definition of channelDefinitions) {
    const existing = guild.channels.cache.find(channel => channel.name === definition.name);
    if (existing) {
      channelsExisting++;
      continue;
    }
    const parent = categories[definition.category];
    if (!parent) {
      errors.push('Canal ' + definition.name + ': no se pudo crear su categoría.');
      continue;
    }
    try {
      const channel = await guild.channels.create({
        name: definition.name,
        type: definition.type,
        parent: parent.id,
        permissionOverwrites: definition.overwrites || (
          definition.type === ChannelType.GuildVoice
            ? (definition.category === 'staff' ? staffVoice : publicVoice)
            : categoryDefinitions.find(c => c.key === definition.category).overwrites
        ),
        reason: 'Plantilla de comunidad de Patoo'
      });
      channelsCreated++;
      if (definition.name.toLowerCase().includes('mod-logs') && channel.isTextBased()) {
        await channel.send({
          embeds: [new EmbedBuilder()
            .setColor(0xE11D2E)
            .setTitle('Registro de moderación')
            .setDescription('Este canal registra las acciones de moderación ejecutadas con Patoo.')
            .setFooter({ text: 'Patoo • Moderación' })
            .setTimestamp()]
        }).catch(() => null);
      }
    } catch (error) {
      errors.push('Canal ' + definition.name + ': ' + error.message);
    }
  }

  const summary = new EmbedBuilder()
    .setColor(errors.length ? 0xF1C40F : 0x2ECC71)
    .setTitle('Plantilla de comunidad procesada')
    .setDescription('La estructura se ha aplicado sin borrar canales ni roles existentes. Los elementos con el mismo nombre se han conservado.')
    .addFields(
      { name: 'Roles', value: 'Creados: **' + rolesCreated + '**\nYa existían: **' + rolesExisting + '**', inline: true },
      { name: 'Categorías', value: 'Creadas: **' + categoriesCreated + '**\nYa existían: **' + categoriesExisting + '**', inline: true },
      { name: 'Canales', value: 'Creados: **' + channelsCreated + '**\nYa existían: **' + channelsExisting + '**', inline: true }
    )
    .setFooter({ text: 'Patoo • Plantillas de servidor' })
    .setTimestamp();

  if (errors.length) {
    summary.addFields({
      name: 'Avisos',
      value: errors.slice(0, 4).map(error => '• ' + error).join('\n').slice(0, 1000) +
        (errors.length > 4 ? '\n• Y ' + (errors.length - 4) + ' aviso(s) más.' : ''),
      inline: false
    });
  }
  await interaction.editReply({ embeds: [summary] });
}

client.once(Events.ClientReady, async readyClient => {
  console.log('Conectado como ' + readyClient.user.tag);

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const applicationId = process.env.CLIENT_ID || readyClient.application.id;
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(applicationId, process.env.GUILD_ID)
      : Routes.applicationCommands(applicationId);

    await rest.put(route, { body: commands });
    console.log('Comandos slash registrados: ' + commands.length);
    if (!process.env.GUILD_ID) {
      console.log('Se registraron comandos globales; pueden tardar en aparecer. Configura GUILD_ID para pruebas inmediatas.');
    }
  } catch (error) {
    console.error('No se pudieron registrar los comandos slash:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'templanes' || interaction.commandName === 'templates') {
      await createCommunityTemplate(interaction);
      return;
    }
    await handleModeration(interaction);
  } catch (error) {
    console.error('Error en /' + interaction.commandName + ':', error);
    const message = '❌ Ocurrió un error al ejecutar el comando. Comprueba los permisos del bot, la jerarquía de roles y los registros del hosting.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [] }).catch(() => null);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
    }
  }
});

client.login(TOKEN);

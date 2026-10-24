const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ButtonBuilder, ActionRowBuilder, ButtonStyle, Events
} = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUTOMOD_FILE = path.join(DATA_DIR, 'automod.json');
const PREFIX = 'P!';
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '';
const TICKET_STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID || '';
const recentMessages = new Map();
const noticeCooldown = new Map();

function commands(P) {
  return [
    new SlashCommandBuilder().setName('say').setDescription('Publica un mensaje como Patoo.')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addStringOption(o => o.setName('mensaje').setDescription('Mensaje que publicará el bot').setMaxLength(1900).setRequired(true)),
    new SlashCommandBuilder().setName('ticket-panel').setDescription('Publica el panel de tickets de la comunidad.')
      .setDefaultMemberPermissions(P.ManageChannels),
    new SlashCommandBuilder().setName('ticket-close').setDescription('Cierra el ticket actual.'),
    new SlashCommandBuilder().setName('automod').setDescription('Activa o desactiva la protección automática.')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addStringOption(o => o.setName('estado').setDescription('Estado del automod').setRequired(true)
        .addChoices({ name: 'Activar', value: 'on' }, { name: 'Desactivar', value: 'off' }))
  ];
}

function loadAutomod() {
  try {
    if (!fs.existsSync(AUTOMOD_FILE)) return { enabled: true };
    return { enabled: JSON.parse(fs.readFileSync(AUTOMOD_FILE, 'utf8')).enabled !== false };
  } catch { return { enabled: true }; }
}

function saveAutomod(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTOMOD_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function ticketPanelPayload() {
  const embed = new EmbedBuilder().setColor(0x7C5CFC)
    .setTitle('🎫 Centro de soporte • Patoo')
    .setDescription('¿Necesitas ayuda? Pulsa el botón para abrir un ticket privado.\n\n• Explica tu consulta con claridad.\n• No abras varios tickets por el mismo tema.\n• El equipo de soporte te responderá cuando esté disponible.')
    .setFooter({ text: 'Patoo • Soporte de la comunidad' });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('patoo:ticket:create').setLabel('Abrir ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary)
  )] };
}

async function createTicket(user, guild, interaction) {
  const existing = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.topic === 'patoo-ticket-owner:' + user.id);
  if (existing) {
    await interaction.reply({ content: 'Ya tienes un ticket abierto: ' + existing.toString(), ephemeral: true });
    return;
  }
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] }
  ];
  const botMember = await guild.members.fetchMe().catch(() => null);
  if (botMember) overwrites.push({ id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] });
  if (TICKET_STAFF_ROLE_ID && guild.roles.cache.has(TICKET_STAFF_ROLE_ID)) {
    overwrites.push({ id: TICKET_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] });
  }
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 18) || 'miembro';
  const options = { name: 'ticket-' + safeName, type: ChannelType.GuildText, topic: 'patoo-ticket-owner:' + user.id, permissionOverwrites: overwrites, reason: 'Ticket abierto por ' + user.tag };
  const category = TICKET_CATEGORY_ID ? guild.channels.cache.get(TICKET_CATEGORY_ID) : null;
  if (category && category.type === ChannelType.GuildCategory) options.parent = category.id;
  const channel = await guild.channels.create(options);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('patoo:ticket:close')
    .setLabel('Cerrar ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  await channel.send({
    content: user.toString() + (TICKET_STAFF_ROLE_ID ? ' <@&' + TICKET_STAFF_ROLE_ID + '>' : ''),
    embeds: [new EmbedBuilder().setColor(0x7C5CFC).setTitle('Ticket de soporte')
      .setDescription('Hola ' + user.toString() + ', describe aquí en qué podemos ayudarte.\n\nCuando termines, pulsa Cerrar ticket.')
      .setTimestamp()],
    components: [row],
    allowedMentions: { users: [user.id], roles: TICKET_STAFF_ROLE_ID ? [TICKET_STAFF_ROLE_ID] : [] }
  });
  await interaction.reply({ content: '✅ Tu ticket fue creado: ' + channel.toString(), ephemeral: true });
}

async function closeTicket(channel, actor, interaction, member) {
  if (!channel || channel.type !== ChannelType.GuildText || !String(channel.topic || '').startsWith('patoo-ticket-owner:')) {
    await interaction.reply({ content: 'Este comando solo funciona dentro de un ticket creado por Patoo.', ephemeral: true }).catch(() => null);
    return;
  }
  const ownerId = channel.topic.slice('patoo-ticket-owner:'.length);
  const isOwner = actor.id === ownerId;
  const canManage = Boolean(member && member.permissions && member.permissions.has(PermissionFlagsBits.ManageChannels));
  if (!isOwner && !canManage && actor.id !== channel.guild.ownerId) {
    await interaction.reply({ content: 'Solo quien abrió el ticket o el staff con Gestionar canales puede cerrarlo.', ephemeral: true }).catch(() => null);
    return;
  }
  await interaction.reply({ content: '🔒 Ticket cerrado. El canal se eliminará en 5 segundos.', ephemeral: true }).catch(() => null);
  await channel.send('🔒 Ticket cerrado por ' + actor.toString() + '. Este canal se eliminará en 5 segundos.').catch(() => null);
  setTimeout(() => channel.delete('Ticket cerrado por ' + actor.tag).catch(() => null), 5000);
}

async function prefixCommand(message, P) {
  if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || '').toLowerCase();
  if (!command) return;
  const member = message.member;
  const reply = text => message.reply({ content: String(text).slice(0, 1900), allowedMentions: { repliedUser: false } }).catch(() => null);
  const has = permission => Boolean(member && member.permissions.has(permission));
  const isMod = has(P.ManageMessages) || has(P.ModerateMembers) || has(P.ManageGuild);

  if (['help', 'ayuda', 'comandos'].includes(command)) {
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x7C5CFC).setTitle('Patoo • Comandos')
      .setDescription('Comunidad: P!ticket, P!say, P!help\nModeración: P!ban @usuario motivo, P!kick @usuario motivo, P!timeout @usuario minutos motivo, P!warn @usuario motivo, P!clear cantidad, P!lock, P!unlock, P!slowmode segundos.\nSlash: /ticket-panel, /ticket-close, /say, /automod y los comandos de moderación.')] }).catch(() => null);
  }
  if (command === 'ticket') return message.channel.send(ticketPanelPayload()).catch(() => null);
  if (command === 'ticketclose' || command === 'close') return closeTicket(message.channel, message.author, { reply: payload => message.reply(payload) }, member);
  if (command === 'say') {
    if (!has(P.ManageMessages)) return reply('⛔ Necesitas Gestionar mensajes para usar este comando.');
    const text = args.join(' ').slice(0, 1900);
    if (!text) return reply('Uso: P!say mensaje');
    await message.delete().catch(() => null);
    return message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  }

  const modCommands = ['ban', 'kick', 'timeout', 'warn', 'clear', 'lock', 'unlock', 'slowmode'];
  if (modCommands.includes(command) && !isMod) return reply('⛔ Necesitas permisos de moderación para usar ese comando.');
  if (['ban', 'kick', 'timeout', 'warn'].includes(command)) {
    const target = message.mentions.members.first();
    if (!target) return reply('Menciona al miembro. Ejemplo: P!' + command + ' @usuario motivo');
    const botMember = message.guild.members.me;
    if (target.id === message.author.id || target.id === message.client.user.id || target.id === message.guild.ownerId ||
      (member.id !== message.guild.ownerId && target.roles.highest.position >= member.roles.highest.position) ||
      (botMember && target.roles.highest.position >= botMember.roles.highest.position)) return reply('⛔ No puedes moderar a ese usuario por la jerarquía de roles.');
    const mentionIndex = args.findIndex(arg => arg.includes(target.id));
    const afterTarget = mentionIndex >= 0 ? args.slice(mentionIndex + 1) : args.slice(1);
    let reason = afterTarget.join(' ') || 'Sin motivo especificado';
    if (command === 'timeout') {
      const minutes = Number(afterTarget[0]);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40320) return reply('Uso: P!timeout @usuario minutos motivo (1–40320 minutos).');
      reason = afterTarget.slice(1).join(' ') || 'Timeout aplicado por moderación';
      return target.timeout(minutes * 60000, reason).then(() => reply('🔇 Timeout aplicado a ' + target.user.tag + ' durante ' + minutes + ' minuto(s).')).catch(() => reply('No pude aplicar timeout; revisa permisos y jerarquía.'));
    }
    if (command === 'ban') return target.ban({ reason }).then(() => reply('🔨 Usuario bloqueado: ' + target.user.tag)).catch(() => reply('No pude bloquear al usuario; revisa permisos.'));
    if (command === 'kick') return target.kick(reason).then(() => reply('👢 Usuario expulsado: ' + target.user.tag)).catch(() => reply('No pude expulsar al usuario; revisa permisos.'));
    if (!afterTarget.length) return reply('Uso: P!warn @usuario motivo');
    return reply('⚠️ Advertencia para ' + target.user.tag + ': ' + reason);
  }
  if (command === 'clear') {
    const amount = Number(args[0]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) return reply('Uso: P!clear 1-100');
    const deleted = await message.channel.bulkDelete(amount + 1, true).catch(() => null);
    return reply('🧹 Eliminados: ' + (deleted ? Math.max(0, deleted.size - 1) : 0) + ' mensaje(s).');
  }
  if (command === 'lock' || command === 'unlock') {
    return message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: command === 'lock' ? false : null })
      .then(() => reply(command === 'lock' ? '🔒 Canal bloqueado.' : '🔓 Canal desbloqueado.')).catch(() => reply('No pude cambiar los permisos del canal.'));
  }
  if (command === 'slowmode') {
    const seconds = Number(args[0]);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) return reply('Uso: P!slowmode segundos (0-21600).');
    return message.channel.setRateLimitPerUser(seconds).then(() => reply(seconds ? '🐢 Modo lento: ' + seconds + 's.' : 'Modo lento desactivado.')).catch(() => reply('No pude cambiar el modo lento.'));
  }
}

async function automodMessage(message) {
  if (!message.guild || message.author.bot) return false;
  if (!loadAutomod().enabled || message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  const content = message.content || '';
  const invite = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i.test(content);
  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  const key = message.guild.id + ':' + message.author.id;
  const now = Date.now();
  const recent = (recentMessages.get(key) || []).filter(item => now - item.time < 8000);
  const repeated = content.length > 0 && recent.some(item => item.content === content);
  recent.push({ time: now, content });
  recentMessages.set(key, recent);
  if (!invite && mentionCount < 6 && !repeated && recent.length < 6) return false;
  await message.delete().catch(() => null);
  const lastNotice = noticeCooldown.get(key) || 0;
  if (now - lastNotice > 5000) {
    noticeCooldown.set(key, now);
    await message.channel.send({ content: message.author.toString() + ' 🛡️ mensaje eliminado por el automod (invitaciones, spam o exceso de menciones).',
      allowedMentions: { users: [message.author.id] } }).then(msg => setTimeout(() => msg.delete().catch(() => null), 6000)).catch(() => null);
  }
  if (recent.length >= 8) {
    const target = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (target && target.moderatable) await target.timeout(60000, 'Automod: spam repetido').catch(() => null);
    recentMessages.set(key, []);
  }
  return true;
}

function attach(client, P) {
  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (interaction.isButton() && interaction.customId === 'patoo:ticket:create') {
        if (!interaction.guild) return interaction.reply({ content: 'Este botón solo funciona en un servidor.', ephemeral: true });
        await createTicket(interaction.user, interaction.guild, interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId === 'patoo:ticket:close') {
        await closeTicket(interaction.channel, interaction.user, interaction, interaction.member);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === 'say') {
        const text = interaction.options.getString('mensaje', true).slice(0, 1900);
        await interaction.reply({ content: '✅ Mensaje publicado.', ephemeral: true });
        await interaction.channel.send({ content: text, allowedMentions: { parse: [] } });
      } else if (interaction.commandName === 'ticket-panel') {
        await interaction.reply({ content: '✅ Panel de tickets publicado.', ephemeral: true });
        await interaction.channel.send(ticketPanelPayload());
      } else if (interaction.commandName === 'ticket-close') {
        await closeTicket(interaction.channel, interaction.user, interaction, interaction.member);
      } else if (interaction.commandName === 'automod') {
        const enabled = interaction.options.getString('estado', true) === 'on';
        saveAutomod({ enabled });
        await interaction.reply({ content: enabled ? '🛡️ Automod activado.' : '⚠️ Automod desactivado.', ephemeral: true });
      }
    } catch (error) {
      console.error('Error en funciones de comunidad:', error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ No se pudo completar la acción. Comprueba los permisos del bot.', ephemeral: true }).catch(() => null);
      }
    }
  });
  client.on(Events.MessageCreate, async message => {
    try {
      if (await automodMessage(message)) return;
      await prefixCommand(message, P);
    } catch (error) { console.error('Error en prefijo/automod:', error); }
  });
}

module.exports = { commands, attach };

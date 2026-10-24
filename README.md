# Patoo — Bot de Discord

Bot de moderación y configuración inicial de comunidades con comandos slash, construido con Node.js y discord.js.

## Funciones

### Plantilla de comunidad

- \`/templanes\` — crea roles, categorías, canales de información, comunidad, juegos, eventos, ayuda, staff y extras.
- \`/templates\` — alias de \`/templanes\`.
- Crea únicamente elementos que no existan con el mismo nombre: no borra canales o roles actuales.
- Configura permisos de lectura para anuncios/reglas y una categoría privada de staff.
- Crea \`mod-logs\` para registrar acciones de moderación.

La plantilla crea roles como Fundador, Administrador, Moderador, Soporte, Eventos, Creador, Partner, Booster, VIP, Miembro, Nuevo, Silenciado y Bot. Los roles se crean vacíos de miembros: así no asigna privilegios automáticamente a nadie. El rol Administrador tiene permisos de gestión, pero no recibe el permiso global de Administrador.

### Moderación

| Comando | Función |
|---|---|
| \`/ban\` | Bloquea a un miembro; permite borrar hasta 7 días de mensajes |
| \`/kick\` | Expulsa a un miembro |
| \`/timeout\` | Restringe temporalmente a un miembro, de 1 minuto a 28 días |
| \`/untimeout\` | Retira un timeout |
| \`/warn\` | Registra una advertencia |
| \`/warnings\` | Consulta las advertencias guardadas |
| \`/clear\` | Elimina de 1 a 100 mensajes recientes |
| \`/slowmode\` | Ajusta el modo lento del canal |
| \`/lock\` | Bloquea la escritura de \`@everyone\` en el canal actual |
| \`/unlock\` | Retira ese bloqueo |
| \`/unban\` | Retira un bloqueo usando el ID del usuario |

Las acciones validan la jerarquía de roles y se registran en el canal cuyo nombre contiene \`mod-logs\`, cuando existe. Las advertencias se guardan en \`data/warnings.json\`. En un hosting con disco efímero, ese archivo puede perderse al reiniciar o desplegar; configura almacenamiento persistente si necesitas conservar las advertencias.

## Instalación

Requisitos: Node.js 20 o superior y una aplicación de bot creada en el [Discord Developer Portal](https://discord.com/developers/applications).

1. Descarga o clona este repositorio.
2. Ejecuta \`npm install\`.
3. Copia \`.env.example\` a \`.env\`.
4. Completa las variables:
   - \`DISCORD_TOKEN\`: token privado del bot.
   - \`CLIENT_ID\`: ID de la aplicación de Discord.
   - \`GUILD_ID\`: ID del servidor donde probarás los comandos. Es opcional; si no se configura, los comandos se publican globalmente y pueden tardar en aparecer.
5. Ejecuta \`npm start\`.

No publiques el token ni lo subas a GitHub. Si se filtra, restablécelo desde Discord Developer Portal.

## Permisos del bot

Al invitarlo, usa los scopes \`bot\` y \`applications.commands\`. Concédele al menos:

- View Channels, Send Messages, Read Message History, Embed Links y Attach Files.
- Manage Roles y Manage Channels para \`/templanes\`.
- Ban Members, Kick Members, Moderate Members, Manage Messages y View Audit Log para moderación.

El rol del bot debe estar por encima de los roles de los miembros a los que moderará. Para que la plantilla cree canales privados y roles, el bot debe tener los permisos de gestión correspondientes. No necesita el permiso global Administrator.

## Despliegue en un hosting

Configura \`DISCORD_TOKEN\`, \`CLIENT_ID\` y \`GUILD_ID\` como variables de entorno del servicio, y usa \`npm start\` como comando de inicio. No pegues el token en el código ni en mensajes públicos.

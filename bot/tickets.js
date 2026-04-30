const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');
const { setDiscordTicketPanelMessageId } = require('../api/_lib/discord-bot-control-store');
const {
    closeDiscordTicketRecord,
    createDiscordTicketRecord,
    reserveDiscordTicketId
} = require('../api/_lib/discord-ticket-store');

const OPEN_TICKET_CUSTOM_ID = 'rodark_ticket_open';
const CLOSE_TICKET_CUSTOM_ID = 'rodark_ticket_close';

function getTicketSystemControl(control) {
    const ticketSystem = control && control.ticketSystem && typeof control.ticketSystem === 'object'
        ? control.ticketSystem
        : {};

    return {
        categoryChannelId: ticketSystem.categoryChannelId ? String(ticketSystem.categoryChannelId) : '',
        panelChannelId: ticketSystem.panelChannelId ? String(ticketSystem.panelChannelId) : '',
        panelMessageId: ticketSystem.panelMessageId ? String(ticketSystem.panelMessageId) : '',
        helperRoleIds: Array.isArray(ticketSystem.helperRoleIds)
            ? ticketSystem.helperRoleIds.map((roleId) => String(roleId)).filter(Boolean)
            : []
    };
}

function buildTicketPanelPayload() {
    const embed = new EmbedBuilder()
        .setTitle('Open a Ticket')
        .setColor(0xf97316)
        .setDescription('Need help from RoDark Studios staff? Open a private ticket and describe what you need.');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(OPEN_TICKET_CUSTOM_ID)
            .setLabel('Open Ticket')
            .setStyle(ButtonStyle.Primary)
    );

    return {
        content: '',
        embeds: [embed],
        components: [row]
    };
}

function buildTicketWelcomePayload(ticketId, openerUserId) {
    const embed = new EmbedBuilder()
        .setTitle(`Ticket #${ticketId}`)
        .setColor(0x22d3ee)
        .setDescription([
            `<@${openerUserId}> opened this ticket.`,
            '',
            'Describe what you need and someone with ticket access will help when available.'
        ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(CLOSE_TICKET_CUSTOM_ID)
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
    );

    return {
        content: `<@${openerUserId}>`,
        embeds: [embed],
        components: [row],
        allowedMentions: {
            users: [String(openerUserId)],
            roles: []
        }
    };
}

async function fetchGuildChannel(client, channelId, label) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        throw new Error(`Configured ${label} ${channelId} could not be found`);
    }

    return channel;
}

async function ensureTicketPanel(client, control) {
    const ticketSystem = getTicketSystemControl(control);
    if (!ticketSystem.categoryChannelId || !ticketSystem.panelChannelId) {
        return;
    }

    const panelChannel = await fetchGuildChannel(client, ticketSystem.panelChannelId, 'ticket panel channel');
    if (panelChannel.type !== ChannelType.GuildText) {
        throw new Error(`Configured ticket panel channel ${ticketSystem.panelChannelId} is not a text channel`);
    }

    const categoryChannel = await fetchGuildChannel(client, ticketSystem.categoryChannelId, 'ticket category');
    if (categoryChannel.type !== ChannelType.GuildCategory) {
        throw new Error(`Configured ticket category ${ticketSystem.categoryChannelId} is not a category`);
    }

    if (!panelChannel.guild || !categoryChannel.guild || panelChannel.guild.id !== categoryChannel.guild.id) {
        throw new Error('Ticket panel channel and ticket category must belong to the same Discord server');
    }

    let panelMessage = null;
    if (ticketSystem.panelMessageId) {
        panelMessage = await panelChannel.messages.fetch(ticketSystem.panelMessageId).catch(() => null);
    }

    const payload = buildTicketPanelPayload();
    if (panelMessage && panelMessage.editable) {
        await panelMessage.edit(payload);
        return;
    }

    panelMessage = await panelChannel.send(payload);
    await setDiscordTicketPanelMessageId(panelMessage.id);
}

function permissionBits(flags) {
    return flags.reduce((bits, flag) => bits | BigInt(flag), 0n);
}

function buildTicketPermissionOverwrites(guild, categoryChannel, openerUserId, helperRoleIds) {
    const overwriteMap = new Map();

    categoryChannel.permissionOverwrites.cache.forEach((overwrite) => {
        overwriteMap.set(String(overwrite.id), {
            id: String(overwrite.id),
            type: overwrite.type,
            allow: BigInt(overwrite.allow.bitfield || 0),
            deny: BigInt(overwrite.deny.bitfield || 0)
        });
    });

    function patchOverwrite(id, type, allowFlags, denyFlags) {
        const key = String(id);
        const current = overwriteMap.get(key) || {
            id: key,
            type,
            allow: 0n,
            deny: 0n
        };
        const allowBits = permissionBits(allowFlags || []);
        const denyBits = permissionBits(denyFlags || []);

        current.type = type;
        current.allow = (current.allow | allowBits) & ~denyBits;
        current.deny = (current.deny | denyBits) & ~allowBits;
        overwriteMap.set(key, current);
    }

    const viewAndReplyFlags = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
    ];

    patchOverwrite(guild.roles.everyone.id, 0, [], [PermissionFlagsBits.ViewChannel]);
    patchOverwrite(openerUserId, 1, [
        ...viewAndReplyFlags,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
    ], []);
    const botUserId = guild.members.me && guild.members.me.id
        ? guild.members.me.id
        : categoryChannel.client.user.id;

    patchOverwrite(botUserId, 1, [
        ...viewAndReplyFlags,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
    ], []);

    helperRoleIds.forEach((roleId) => {
        if (guild.roles.cache.has(roleId)) {
            patchOverwrite(roleId, 0, viewAndReplyFlags, []);
        }
    });

    return Array.from(overwriteMap.values()).map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny
    }));
}

async function createTicketChannel(interaction, control) {
    const ticketSystem = getTicketSystemControl(control);
    if (!ticketSystem.categoryChannelId || !ticketSystem.panelChannelId) {
        await interaction.editReply('The ticket system is not configured yet.');
        return;
    }

    if (interaction.channelId !== ticketSystem.panelChannelId) {
        await interaction.editReply('Use the configured ticket panel channel to open a ticket.');
        return;
    }

    const categoryChannel = await interaction.guild.channels.fetch(ticketSystem.categoryChannelId).catch(() => null);
    if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
        await interaction.editReply('The configured ticket category could not be found.');
        return;
    }

    const ticketId = await reserveDiscordTicketId();
    const channelName = `ticket-${ticketId}`;
    const permissionOverwrites = buildTicketPermissionOverwrites(
        interaction.guild,
        categoryChannel,
        interaction.user.id,
        ticketSystem.helperRoleIds
    );

    const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryChannel.id,
        permissionOverwrites,
        reason: `Ticket ${ticketId} opened by ${interaction.user.tag || interaction.user.id}`
    });

    await createDiscordTicketRecord({
        ticketId,
        guildId: interaction.guild.id,
        channelId: ticketChannel.id,
        openerUserId: interaction.user.id
    });

    await ticketChannel.send(buildTicketWelcomePayload(ticketId, interaction.user.id));
    await interaction.editReply(`Ticket created: ${ticketChannel.toString()}`);
}

async function closeTicketChannel(interaction) {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply('This ticket channel could not be closed.');
        return;
    }

    await closeDiscordTicketRecord(channel.id, interaction.user.id);
    await interaction.editReply('Closing this ticket.');
    await channel.send({
        content: `Ticket closed by <@${interaction.user.id}>. This channel will be deleted shortly.`,
        allowedMentions: {
            users: [interaction.user.id],
            roles: []
        }
    }).catch(() => null);

    setTimeout(() => {
        channel.delete(`Ticket closed by ${interaction.user.tag || interaction.user.id}`).catch((error) => {
            console.error('Failed to delete closed ticket channel:', error);
        });
    }, 5000);
}

async function handleTicketInteraction(interaction, control) {
    if (!interaction || !interaction.isButton()) {
        return false;
    }

    if (interaction.customId !== OPEN_TICKET_CUSTOM_ID && interaction.customId !== CLOSE_TICKET_CUSTOM_ID) {
        return false;
    }

    await interaction.deferReply({ ephemeral: true });

    if (interaction.customId === OPEN_TICKET_CUSTOM_ID) {
        await createTicketChannel(interaction, control);
        return true;
    }

    await closeTicketChannel(interaction);
    return true;
}

module.exports = {
    ensureTicketPanel,
    handleTicketInteraction,
    getTicketSystemControl
};

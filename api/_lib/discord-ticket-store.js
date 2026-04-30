const { ensureDiscordBotControlSchema } = require('./discord-bot-control-store');
const { postgresQuery } = require('./postgres');

async function reserveDiscordTicketId() {
    await ensureDiscordBotControlSchema();

    const result = await postgresQuery(`
        select nextval('discord_bot_ticket_id_seq') as ticket_id
    `);

    return Number(result.rows[0].ticket_id);
}

async function createDiscordTicketRecord(ticket) {
    await ensureDiscordBotControlSchema();

    await postgresQuery(`
        insert into discord_bot_tickets (
            ticket_id,
            guild_id,
            channel_id,
            opener_user_id,
            status
        )
        values ($1, $2, $3, $4, 'open')
        on conflict (ticket_id) do nothing
    `, [
        ticket.ticketId,
        String(ticket.guildId),
        String(ticket.channelId),
        String(ticket.openerUserId)
    ]);
}

async function closeDiscordTicketRecord(channelId, closedByUserId) {
    await ensureDiscordBotControlSchema();

    await postgresQuery(`
        update discord_bot_tickets
        set
            status = 'closed',
            closed_at = coalesce(closed_at, now()),
            closed_by_user_id = coalesce(closed_by_user_id, $2)
        where channel_id = $1
    `, [
        String(channelId),
        closedByUserId ? String(closedByUserId) : null
    ]);
}

module.exports = {
    reserveDiscordTicketId,
    createDiscordTicketRecord,
    closeDiscordTicketRecord
};

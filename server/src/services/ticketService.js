import { query } from '../db/pool.js';

const PAGE_SIZE = 20;

const SORT_COLUMNS = Object.assign(Object.create(null), {
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  priority: 't.priority',
  status: 't.status',
});

const SORT_DIRECTIONS = Object.assign(Object.create(null), {
  asc: 'ASC',
  desc: 'DESC',
});

const SLA_JOIN = `
  LEFT JOIN (
    SELECT c.ticket_id, MIN(c.created_at) AS first_response_at
      FROM comments c
      JOIN users u ON u.id = c.author_id
     WHERE c.is_internal = 0 AND u.role IN ('agent', 'admin')
     GROUP BY c.ticket_id
  ) resp ON resp.ticket_id = t.id
`;

const SLA_BREACHED_CONDITION = `(
  CASE
    WHEN resp.first_response_at IS NOT NULL THEN
      resp.first_response_at > DATE_ADD(t.created_at, INTERVAL (CASE t.priority WHEN 'P1' THEN 4 WHEN 'P2' THEN 24 ELSE 72 END) HOUR)
    ELSE
      UTC_TIMESTAMP() > DATE_ADD(t.created_at, INTERVAL (CASE t.priority WHEN 'P1' THEN 4 WHEN 'P2' THEN 24 ELSE 72 END) HOUR)
  END
)`;

const SLA_SELECT_FIELDS = `
  (CASE t.priority WHEN 'P1' THEN 4 WHEN 'P2' THEN 24 ELSE 72 END) AS sla_target_hours,
  DATE_ADD(t.created_at, INTERVAL (CASE t.priority WHEN 'P1' THEN 4 WHEN 'P2' THEN 24 ELSE 72 END) HOUR) AS sla_deadline,
  resp.first_response_at,
  ${SLA_BREACHED_CONDITION} AS is_breached,
  (CASE
    WHEN resp.first_response_at IS NOT NULL THEN
      CASE
        WHEN resp.first_response_at <= DATE_ADD(t.created_at, INTERVAL (CASE t.priority WHEN 'P1' THEN 4 WHEN 'P2' THEN 24 ELSE 72 END) HOUR) THEN 'met'
        ELSE 'breached'
      END
    ELSE
      CASE
        WHEN UTC_TIMESTAMP() > DATE_ADD(t.created_at, INTERVAL (CASE t.priority WHEN 'P1' THEN 4 WHEN 'P2' THEN 24 ELSE 72 END) HOUR) THEN 'breached'
        ELSE 'pending'
      END
  END) AS sla_status
`;

/**
 * Paginated ticket list for the current organisation.
 *
 * Supports free-text search on subject, filtering by status and priority,
 * and sorting by any column the UI exposes in its dropdown.
 */
export async function listTickets({
  orgId,
  page = 1,
  search = '',
  status,
  priority,
  sortBy = 'created_at',
  order = 'desc',
  breached = false,
}) {
  const where = ['t.org_id = ?'];
  const params = [orgId];

  if (search) {
    where.push('t.subject LIKE ?');
    params.push(`%${search}%`);
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (priority) {
    where.push('t.priority = ?');
    params.push(priority);
  }
  if (breached) {
    where.push(SLA_BREACHED_CONDITION);
  }

  const whereSql = where.join(' AND ');
  const offset = page * PAGE_SIZE;

  const cleanSort = typeof sortBy === 'string' ? sortBy.trim() : '';
  const cleanOrder = typeof order === 'string' ? order.trim().toLowerCase() : '';

  const sortColumn = SORT_COLUMNS[cleanSort] || SORT_COLUMNS.created_at;
  const sortDirection = SORT_DIRECTIONS[cleanOrder] || SORT_DIRECTIONS.desc;

  const rows = await query(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
            t.assignee_id, u.name AS assignee_name, r.name AS requester_name,
            ${SLA_SELECT_FIELDS}
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assignee_id
       JOIN users r ON r.id = t.requester_id
       ${SLA_JOIN}
      WHERE ${whereSql}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );

  for (const row of rows) {
    row.is_breached = Boolean(row.is_breached);
  }

  // Attach the comment count each row needs for the list badge.
  for (const row of rows) {
    const [{ c }] = await query('SELECT COUNT(*) AS c FROM comments WHERE ticket_id = ?', [row.id]);
    row.comment_count = c;
  }

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total
       FROM tickets t
       ${SLA_JOIN}
      WHERE ${whereSql}`,
    params
  );

  return { rows, total, page, pageSize: PAGE_SIZE };
}

export async function getTicketById(id, orgId) {
  const rows = await query(
    `SELECT t.*, u.name AS assignee_name, r.name AS requester_name, r.email AS requester_email,
            ${SLA_SELECT_FIELDS}
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assignee_id
       JOIN users r ON r.id = t.requester_id
       ${SLA_JOIN}
      WHERE t.id = ? AND t.org_id = ?`,
    [id, orgId]
  );
  if (!rows[0]) return null;
  rows[0].is_breached = Boolean(rows[0].is_breached);
  return rows[0];
}

export async function listComments(ticketId) {
  return query(
    `SELECT c.id, c.body, c.is_internal, c.created_at, u.name AS author_name, u.role AS author_role
       FROM comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id = ?
      ORDER BY c.created_at ASC`,
    [ticketId]
  );
}

export async function createTicket({ orgId, subject, body, priority, requesterId }) {
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const result = await query(
    `INSERT INTO tickets (org_id, subject, body, priority, requester_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orgId, subject, body, priority, requesterId, createdAt, createdAt]
  );
  return getTicketById(result.insertId, orgId);
}

export async function assignTicket(ticketId, assigneeId, orgId) {
  const ticket = await getTicketById(ticketId, orgId);
  if (!ticket) return null;

  if (ticket.assignee_id) {
    return { conflict: true, ticket };
  }

  // Look up the agent so the response carries a display name for the toast.
  const [agent] = await query('SELECT id, name FROM users WHERE id = ?', [assigneeId]);

  await query('UPDATE tickets SET assignee_id = ?, status = ? WHERE id = ?', [assigneeId, 'pending', ticketId]);
  return { conflict: false, assignedTo: agent, ticket: await getTicketById(ticketId, orgId) };
}

export async function deleteTicket(id) {
  await query('DELETE FROM tickets WHERE id = ?', [id]);
}

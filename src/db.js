import pg from 'pg';
const { Pool } = pg;

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

// ── Config ────────────────────────────────────────────────
export async function getConfig() {
  const { rows } = await getPool().query('SELECT * FROM jobhunter_config WHERE id=1');
  return rows[0] || null;
}

// ── Groups ────────────────────────────────────────────────
export async function getActiveGroups() {
  const { rows } = await getPool().query(
    "SELECT * FROM jobhunter_groups WHERE status='active' ORDER BY \"order\" ASC"
  );
  return rows;
}

export async function updateGroupScan(groupId) {
  await getPool().query(
    'UPDATE jobhunter_groups SET last_scan=NOW() WHERE id=$1',
    [groupId]
  );
}

// ── Skills ────────────────────────────────────────────────
export async function getSkills() {
  const { rows } = await getPool().query(
    'SELECT name FROM jobhunter_skills ORDER BY "order" ASC'
  );
  return rows.map(r => r.name);
}

// ── Matches ───────────────────────────────────────────────
export async function saveMatch(groupId, title, content, author, postUrl, matchScore) {
  // Deduplicate by title + group
  const existing = await getPool().query(
    'SELECT id FROM jobhunter_matches WHERE title=$1 AND group_id=$2',
    [title, groupId]
  );
  if (existing.rows[0]) return existing.rows[0]; // already tracked

  const { rows } = await getPool().query(
    `INSERT INTO jobhunter_matches (group_id, title, content, author, post_url, match_score)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [groupId, title, content, author, postUrl, matchScore]
  );
  return rows[0];
}

export async function markNotified(matchId) {
  await getPool().query('UPDATE jobhunter_matches SET notified=true WHERE id=$1', [matchId]);
}

export default getPool;

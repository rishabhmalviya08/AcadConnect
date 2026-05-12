const fs = require('fs').promises;
const path = require('path');

/**
 * Resolve path to faculty.json (no hardcoded single path).
 * Set FACULTY_JSON_PATH to an absolute path in .env to override.
 */
function getFacultyJsonCandidates() {
  const list = [];
  if (process.env.FACULTY_JSON_PATH) {
    list.push(path.resolve(process.env.FACULTY_JSON_PATH));
  }
  list.push(path.join(process.cwd(), 'faculty.json'));
  list.push(path.join(process.cwd(), '..', 'faculty.json'));
  list.push(path.join(process.cwd(), '..', '..', 'faculty.json'));
  // From project-service/src/lib → AcadConnect/faculty.json
  list.push(path.resolve(__dirname, '../../../../../faculty.json'));
  return [...new Set(list)];
}

/**
 * Read and parse faculty.json from the first readable candidate path.
 * @returns {{ filePath: string|null, records: object[]|null, error: string|null }}
 */
async function readFacultyJsonRecords() {
  for (const filePath of getFacultyJsonCandidates()) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        return { filePath, records: null, error: 'faculty.json must be a JSON array' };
      }
      return { filePath, records: data, error: null };
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      return { filePath, records: null, error: e.message || String(e) };
    }
  }
  return { filePath: null, records: null, error: null };
}

/**
 * Build directory list: primary source is faculty.json when found; merge DB user id + profile when email matches.
 * Falls back to DB-only when JSON is missing or empty.
 */
async function listFacultyMerged(db) {
  const { filePath, records, error: readErr } = await readFacultyJsonRecords();

  if (readErr) {
    return {
      source: 'error',
      faculty_json_path: filePath,
      read_error: readErr,
      faculty: await listFacultyDatabaseOnly(db),
    };
  }

  if (!records || records.length === 0) {
    return {
      source: 'database',
      faculty_json_path: filePath,
      read_error: filePath
        ? 'faculty.json is empty'
        : 'faculty.json not found (set FACULTY_JSON_PATH or place faculty.json next to the process cwd)',
      faculty: await listFacultyDatabaseOnly(db),
    };
  }

  const seen = new Set();
  const uniqueRecords = [];
  for (const r of records) {
    const em = (r.email && String(r.email).trim().toLowerCase()) || '';
    if (em) {
      if (seen.has(em)) continue;
      seen.add(em);
    }
    uniqueRecords.push(r);
  }

  const emails = [
    ...new Set(
      uniqueRecords
        .map((r) => (r.email && String(r.email).trim().toLowerCase()) || '')
        .filter(Boolean)
    ),
  ];

  let emailToUser = {};
  if (emails.length > 0) {
    const placeholders = emails.map(() => '?').join(',');
    const rows = await db('users as u')
      .leftJoin('faculty_profiles as fp', 'u.id', 'fp.user_id')
      .where('u.role', 'faculty')
      .whereRaw(`LOWER(TRIM(u.email)) IN (${placeholders})`, emails)
      .select('u.id as faculty_id', 'u.name', 'u.email', 'fp.research_areas');

    for (const row of rows) {
      const key = String(row.email || '').trim().toLowerCase();
      if (key) emailToUser[key] = row;
    }
  }

  const faculty = uniqueRecords.map((r) => {
    const email = (r.email && String(r.email).trim().toLowerCase()) || '';
    const jsonName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || email || 'Faculty';
    const jsonAreas = Array.isArray(r.research_areas) ? r.research_areas : [];
    const match = email ? emailToUser[email] : null;
    const dbAreas = match && Array.isArray(match.research_areas) ? match.research_areas : [];
    return {
      faculty_id: match?.faculty_id || null,
      name: match?.name || jsonName,
      research_areas: dbAreas.length ? dbAreas : jsonAreas,
      email: r.email || null,
      in_database: !!match?.faculty_id,
    };
  });

  // Include faculty who exist only in Postgres (e.g. dev seed accounts) but are not listed in faculty.json.
  const emailsSeen = new Set();
  const idsSeen = new Set();
  for (const f of faculty) {
    const em = (f.email && String(f.email).trim().toLowerCase()) || '';
    if (em) emailsSeen.add(em);
    if (f.faculty_id != null) idsSeen.add(String(f.faculty_id));
  }
  const fromDb = await listFacultyDatabaseOnly(db);
  for (const row of fromDb) {
    const em = (row.email && String(row.email).trim().toLowerCase()) || '';
    const id = row.faculty_id != null ? String(row.faculty_id) : '';
    if (id && idsSeen.has(id)) continue;
    if (em && emailsSeen.has(em)) continue;
    if (!id && !em) continue;
    if (em) emailsSeen.add(em);
    if (id) idsSeen.add(id);
    faculty.push({
      faculty_id: row.faculty_id,
      name: row.name,
      research_areas: Array.isArray(row.research_areas) ? row.research_areas : [],
      email: row.email || null,
      in_database: true,
    });
  }

  faculty.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));

  return {
    source: 'faculty.json',
    faculty_json_path: filePath,
    read_error: null,
    faculty,
  };
}

async function listFacultyDatabaseOnly(db) {
  const rows = await db('users as u')
    .leftJoin('faculty_profiles as fp', 'u.id', 'fp.user_id')
    .where('u.role', 'faculty')
    .select('u.id as faculty_id', 'u.name', 'u.email', 'fp.research_areas')
    .orderBy('u.name', 'asc');

  return rows.map((r) => ({
    faculty_id: r.faculty_id,
    name: r.name,
    research_areas: Array.isArray(r.research_areas) ? r.research_areas : [],
    email: r.email || null,
    in_database: true,
  }));
}

module.exports = {
  getFacultyJsonCandidates,
  readFacultyJsonRecords,
  listFacultyMerged,
  listFacultyDatabaseOnly,
};

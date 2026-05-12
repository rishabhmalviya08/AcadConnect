const express = require('express');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');
const { listFacultyMerged } = require('../lib/facultyFromJson');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/faculty
 * Faculty directory from faculty.json when the file is found (path: FACULTY_JSON_PATH or common locations),
 * merged with DB user ids when emails match. Also appends any faculty users in Postgres who are not listed in the
 * JSON (e.g. dev seed accounts). Re-reads the file on every request. If the file is missing or empty, falls back to
 * Postgres-only faculty.
 */
router.get('/', async (req, res, next) => {
  try {
    const { source, faculty_json_path, read_error, faculty } = await listFacultyMerged(db);

    res.status(200).json({
      faculty,
      meta: {
        source,
        faculty_json_path,
        read_error,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

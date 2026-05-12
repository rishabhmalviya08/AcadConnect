const express = require('express');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');
const { createError } = require('../utils/errors');
const { listFacultyMerged } = require('../lib/facultyFromJson');

const router = express.Router();

/** Word tokens for overlap scoring (no external ML). */
function tokenize(text) {
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(words.filter((w) => w.length >= 2));
}

function jaccardTokenScore(querySet, researchAreas) {
  const doc = tokenize((Array.isArray(researchAreas) ? researchAreas : []).join(' '));
  if (querySet.size === 0 || doc.size === 0) return 0;
  let inter = 0;
  for (const t of querySet) {
    if (doc.has(t)) inter += 1;
  }
  const union = querySet.size + doc.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * GET /api/recommend/faculty
 * Rank faculty by token overlap between query (skills/interests or student profile) and research_areas.
 * Same response shape as the Python recommendation service.
 *
 * Query: skills?, interests?, student_id?, top_k? (1–20, default 5)
 */
router.get('/faculty', authenticate, async (req, res, next) => {
  try {
    const skills = (req.query.skills || '').trim();
    const interests = (req.query.interests || '').trim();
    const studentId = (req.query.student_id || '').trim();
    let topK = parseInt(req.query.top_k, 10);
    if (Number.isNaN(topK) || topK < 1) topK = 5;
    if (topK > 20) topK = 20;

    let queryText = '';

    if (studentId) {
      if (studentId !== req.user.id) {
        throw createError(403, 'student_id must match the authenticated user');
      }
      const row = await db('student_profiles as sp')
        .join('users as u', 'sp.user_id', 'u.id')
        .where('sp.user_id', studentId)
        .andWhere('u.role', 'student')
        .select('sp.skills', 'sp.interests')
        .first();
      if (!row) throw createError(404, `Student '${studentId}' not found`);

      const skillList = row.skills || [];
      const interestText = row.interests || '';
      queryText = [...skillList].filter(Boolean).join(', ');
      if (interestText) queryText = queryText ? `${queryText}; ${interestText}` : interestText;
    } else if (skills || interests) {
      const parts = [];
      if (skills) parts.push(skills);
      if (interests) parts.push(interests);
      queryText = parts.join('; ');
    } else {
      throw createError(400, 'Provide student_id, or skills/interests query params');
    }

    if (!queryText.trim()) {
      throw createError(400, 'Student has no skills or interests to match');
    }

    const queryTokens = tokenize(queryText);
    if (queryTokens.size === 0) {
      throw createError(400, 'Add more specific keywords (at least 2 letters) to match faculty research areas');
    }

    const { faculty: merged } = await listFacultyMerged(db);

    const scored = merged.map((r) => ({
      faculty_id: r.faculty_id || '',
      name: r.name,
      research_areas: Array.isArray(r.research_areas) ? r.research_areas : [],
      score: jaccardTokenScore(queryTokens, r.research_areas),
    }));

    scored.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));

    const recommendations = scored.slice(0, topK).map((r) => ({
      ...r,
      score: Math.round(Number(r.score) * 10000) / 10000,
    }));

    res.status(200).json({
      recommendations,
      query_text: queryText,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

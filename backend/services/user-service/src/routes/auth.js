const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/knex');
const { createError } = require('../utils/errors');

const router = express.Router();

/**
 * POST /api/auth/register
 * Registers a new user (student, faculty, or admin).
 * Creates the role-specific profile row automatically.
 *
 * Body: { name, email, password, role: 'student'|'faculty'|'admin' }
 * Response 201: { user: { id, name, email, role }, token }
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, password, role } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    // ── Validation ──────────────────────────────────────────
    if (!name || !email || !password || !role) {
      throw createError(400, 'name, email, password, and role are required');
    }
    if (!['student', 'faculty', 'admin'].includes(role)) {
      throw createError(400, "role must be 'student', 'faculty', or 'admin'");
    }
    if (password.length < 8) {
      throw createError(400, 'password must be at least 8 characters');
    }

    // ── Check duplicate email (case-insensitive vs existing rows) ──
    const existing = await db('users')
      .whereRaw('LOWER(TRIM(email)) = ?', [email])
      .first();
    if (existing) throw createError(409, 'Email already registered');

    // ── Hash password & insert user ──────────────────────────
    const password_hash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    await db.transaction(async (trx) => {
      await trx('users').insert({
        id: userId,
        name,
        email,
        password_hash,
        role,
      });

      // Create the role-specific profile row
      if (role === 'student') {
        await trx('student_profiles').insert({
          id: uuidv4(),
          user_id: userId,
          skills: [],
          interests: null,
          eligibility_status: 'eligible',
        });
      } else if (role === 'faculty') {
        await trx('faculty_profiles').insert({
          id: uuidv4(),
          user_id: userId,
          research_areas: [],
          max_capacity: 3,
        });
      }
      // admin has no separate profile table
    });

    // ── Issue JWT ────────────────────────────────────────────
    const token = jwt.sign(
      { id: userId, email, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      user: { id: userId, name, email, role },
      token,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Authenticates existing user, returns a fresh JWT.
 *
 * Body: { email, password }
 * Response 200: { user: { id, name, email, role }, token }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { password } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (!email || !password) {
      throw createError(400, 'email and password are required');
    }

    const user = await db('users')
      .whereRaw('LOWER(TRIM(email)) = ?', [email])
      .first();
    if (!user) throw createError(401, 'Invalid credentials');

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) throw createError(401, 'Invalid credentials');

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(200).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const rows = await query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { sub: user.id, orgId: user.org_id, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Completes an emailed invitation. The invite link carries the user id;
 * the new joiner picks their own password here.
 */
router.post('/invite/accept', (req, res) => {
  res.status(501).json({ error: 'Invitation acceptance is not implemented' });
});

export default router;

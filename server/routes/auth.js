const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db/pool');
const { signUser, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const result = await query('SELECT * FROM users WHERE username=$1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid login' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid login' });
    const token = signUser(user);
    res.json({ token, user: { id:user.id, username:user.username, name:user.name, role:user.role } });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Change password for the currently authenticated user.
// Requires current_password verification — never resets without proof of identity.
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }
    if (new_password.length < 12) {
      return res.status(400).json({ error: 'new_password must be at least 12 characters' });
    }
    if (current_password === new_password) {
      return res.status(400).json({ error: 'new_password must differ from current_password' });
    }

    const result = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);

    res.json({ ok: true, message: 'Password updated. All existing sessions remain valid until they expire.' });
  } catch (err) { next(err); }
});

module.exports = router;

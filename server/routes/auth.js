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

module.exports = router;

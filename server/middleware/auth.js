const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'change_this_to_a_long_random_secret' || JWT_SECRET === 'dev_secret_change_me') {
  console.error('FATAL: JWT_SECRET is not set or is a known placeholder. Set a strong random value in .env.');
  process.exit(1);
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
  }
}

module.exports = { signUser, requireAuth };

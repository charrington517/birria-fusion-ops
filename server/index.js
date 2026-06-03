require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false
}));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

app.get('/api/public-health', (req, res) => {
  res.json({ ok:true, app:'TruckFlow Ops' });
});

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

const clientDist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (req, res) => {
    res.status(200).send('<h1>TruckFlow Ops API is running</h1><p>Client build missing. Run: npm run build</p>');
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TruckFlow Ops running on port ${PORT}`);
});

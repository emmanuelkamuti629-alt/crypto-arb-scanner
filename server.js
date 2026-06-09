require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from /public folder
app.use(express.static(path.join(__dirname, 'public')));

// Using the key 'MONGODB_URL' as confirmed in your environment
const dbUrl = process.env.MONGODB_URL;

if (!dbUrl) {
  console.error("FATAL ERROR: MONGODB_URL is not defined in environment variables.");
  process.exit(1);
}

// 1. Database Connection
mongoose.connect(dbUrl)
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch(err => console.error("MongoDB connection error:", err));

// 2. Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: dbUrl
  }),
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in prod
    httpOnly: true
  }
}));

// 3. Frontend Route - THIS FIXES "Cannot GET /"
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 4. API Route
app.get('/api/get-arbitrage-data', async (req, res) => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/exchanges/binance/tickers', {
      headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }
    });
    res.json(response.data.tickers);
  } catch (err) {
    console.error("API Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// 5. Catch-all for SPA routing - send to dashboard for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));

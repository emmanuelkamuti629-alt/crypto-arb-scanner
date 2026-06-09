require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs'); // <-- CHANGED THIS LINE

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB URL check
const dbUrl = process.env.MONGODB_URL;
if (!dbUrl) {
  console.error("FATAL ERROR: MONGODB_URL is not defined in environment variables.");
  process.exit(1);
}

// 1. Database Connection
mongoose.connect(dbUrl)
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch(err => console.error("MongoDB connection error:", err));

// 2. User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

// 3. Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: dbUrl }),
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// 4. Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10); // Same API
    const user = new User({ email, password: hashedPassword });
    await user.save();

    req.session.userId = user._id;
    res.json({ message: 'User created', userId: user._id });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password); // Same API
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user._id;
    res.json({ message: 'Logged in successfully', userId: user._id });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Could not log out' });
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = await User.findById(req.session.userId).select('-password');
  res.json(user);
});

// 5. Your existing API route
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

// 6. Frontend Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));

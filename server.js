require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.set('Cache-Control', 'no-store');
    }
  }
}));

const dbUrl = process.env.MONGODB_URL;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY; // Add this to Render env

if (!dbUrl) {
  console.error("FATAL ERROR: MONGODB_URL is not defined");
  process.exit(1);
}

// 1. Database Connection
mongoose.connect(dbUrl)
 .then(() => console.log("Connected to MongoDB Atlas"))
 .catch(err => console.error("MongoDB connection error:", err));

// 2. User Schema - added name + subscription
const userSchema = new mongoose.Schema({
  name: { type: String, default: 'User' },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  subscription: {
    plan: { type: String, enum: ['free', 'weekly', 'monthly'], default: 'free' },
    status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
    expiresAt: Date
  },
  accountId: { type: Number, default: () => Math.floor(10000 + Math.random() * 90000) },
  createdAt: { type: Date, default: Date.now }
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

// Middleware to check login
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
};

// 4. Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email ||!password) return res.status(400).json({ error: 'Email and password required' });

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name: name || 'User', email, password: hashedPassword });
    await user.save();

    req.session.userId = user._id;
    res.json({ message: 'User created', userId: user._id });
  } catch (err) {
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ error: 'Invalid credentials' });

    req.session.userId = user._id;
    res.json({ message: 'Logged in successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Could not log out' });
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).select('-password');
  res.json(user);
});

// 5. Paystack M-Pesa Payment
app.post('/api/subscribe', requireAuth, async (req, res) => {
  try {
    const { plan, phone } = req.body; // plan: 'weekly' or 'monthly', phone: '2547xxxxxxx'
    const user = await User.findById(req.session.userId);
    
    const amounts = { weekly: 10000, monthly: 35000 }; // KES 100 = 10000 kobo, KES 350 = 35000 kobo
    if (!amounts[plan]) return res.status(400).json({ error: 'Invalid plan' });

    // Initialize Paystack transaction
    const paystackRes = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: user.email,
      amount: amounts[plan],
      currency: 'KES',
      mobile_money: { phone, provider: 'mpesa' },
      metadata: { userId: user._id.toString(), plan }
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });

    res.json({ 
      message: 'STK push sent to your phone',
      reference: paystackRes.data.data.reference 
    });
  } catch (err) {
    console.error('Paystack error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// 6. Paystack Webhook - to confirm payment
app.post('/api/paystack-webhook', async (req, res) => {
  const event = req.body;
  if (event.event === 'charge.success') {
    const { userId, plan } = event.data.metadata;
    const days = plan === 'weekly'? 7 : 30;
    
    await User.findByIdAndUpdate(userId, {
      'subscription.plan': plan,
      'subscription.status': 'active',
      'subscription.expiresAt': new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    });
  }
  res.sendStatus(200);
});

// 7. Arbitrage API - mock data for now
app.get('/api/get-arbitrage-data', requireAuth, async (req, res) => {
  // TODO: Replace with real multi-exchange scanning
  const mockData = [
    { id: 1, pair: 'WKC/USDT', buyExchange: 'Gate.io', sellExchange: 'BitMart', spread: 1.9, buyPrice: 0.00000006, sellPrice: 0.00000006, liquidity: 1109 },
    { id: 2, pair: 'NAVX/USDT', buyExchange: 'Bitrue', sellExchange: 'ByBit', spread: 1.9, liquidity: 152 },
    { id: 3, pair: 'SLX/USDT', buyExchange: 'XT', sellExchange: 'MEXC', spread: 1.5, liquidity: 754 },
  ];
  res.json(mockData);
});

// 8. Frontend Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));

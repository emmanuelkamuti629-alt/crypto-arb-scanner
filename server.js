const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const JWT_SECRET = 'your-super-secret-jwt-key-change-this';

// Debug: Check if env var exists
console.log('=== ENV DEBUG ===');
console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);
console.log('First 30 chars:', process.env.MONGODB_URI?.substring(0, 30));
console.log('================');

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err.message));

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  balance: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalLosses: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// Auth middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed });
    await user.save();
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    res.status(400).json({ error: 'Username taken' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/user', auth, async (req, res) => {
  res.json({
    username: req.user.username,
    balance: req.user.balance,
    totalEarnings: req.user.totalEarnings,
    totalLosses: req.user.totalLosses
  });
});

app.post('/api/deposit', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    req.user.balance += Number(amount);
    await req.user.save();
    res.json({ newBalance: req.user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Deposit failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));

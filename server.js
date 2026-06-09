const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// === ENV DEBUG === 
console.log('=== ENV DEBUG ===');
console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);
console.log('First 30 chars:', process.env.MONGODB_URI?.substring(0, 30));
console.log('================');

// === MONGODB SETUP ===
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalLosses: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

// === MIDDLEWARE ===
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// === API ROUTES ===
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret123');
    res.json({ token });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret123');
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/deposit', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    
    req.user.balance += amount;
    await req.user.save();
    res.json({ newBalance: req.user.balance });
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

app.get('/health', (req, res) => {
  res.json({ status: 'Server running', mongo: !!mongoose.connection.readyState });
});

// === SERVE FRONTEND ===
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));

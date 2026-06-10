const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

console.log('Starting ArbiMine...');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/arbimine')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// User schema
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  mpesa: String,
  password: String
});
const User = mongoose.model('User', userSchema);

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    console.log('Register attempt:', req.body.username);
    const { username, email, mpesa, password } = req.body;
    if (!username || !email || !mpesa || !password) {
      return res.json({ success: false, error: 'All fields required' });
    }
    const exists = await User.findOne({ username });
    if (exists) return res.json({ success: false, error: 'Username taken' });
    
    const user = new User({ username, email, mpesa, password });
    await user.save();
    console.log('User created:', username);
    res.json({ success: true });
  } catch (err) {
    console.error('Register error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) {
      console.log('Login success:', username);
      res.json({ success: true, user: username });
    } else {
      res.json({ success: false, error: 'Invalid login' });
    }
  } catch (err) {
    console.error('Login error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));

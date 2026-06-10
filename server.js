const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Connect to MongoDB - use Render env var
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/arbimine');

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
    const { username, email, mpesa, password } = req.body;
    if (!username || !email || !mpesa || !password) {
      return res.json({ success: false, error: 'All fields required' });
    }
    const exists = await User.findOne({ username });
    if (exists) return res.json({ success: false, error: 'Username taken' });
    
    const user = new User({ username, email, mpesa, password });
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: 'Server error' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) res.json({ success: true, user: username });
    else res.json({ success: false, error: 'Invalid login' });
  } catch (err) {
    res.json({ success: false, error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));



const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: 'your_secret_key', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 hour session
}));

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/arbimine');

// User Schema
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    otp: String,
    otpExpires: Date
});
const User = mongoose.model('User', UserSchema);

// Email setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'your-email@gmail.com', pass: 'your-app-password' }
});

// --- AUTH ROUTES ---

// Registration
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ email, password: hashedPassword });
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ success: false, message: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = user.email;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Password Reset Request
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'Email not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 300000; // 5 minutes
    await user.save();

    await transporter.sendMail({
        to: email,
        subject: 'Password Reset OTP',
        text: `Your OTP is ${otp}. It expires in 5 minutes.`
    });
    res.json({ success: true });
});

// Verify OTP & Update Password
app.post('/api/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email, otp, otpExpires: { $gt: Date.now() } });
    
    if (!user) return res.status(400).json({ message: 'Invalid or expired OTP' });

    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
    res.json({ success: true });
});

// --- PROTECTED ROUTES ---
// Only allow access to files if user is logged in
app.use((req, res, next) => {
    const publicPaths = ['/', '/api/login', '/api/register', '/api/forgot-password', '/api/reset-password'];
    if (req.session.user || publicPaths.includes(req.path) || req.path.endsWith('.css') || req.path.endsWith('.js')) {
        next();
    } else {
        res.redirect('/');
    }
});

app.listen(3000, () => console.log('ArbiMine server running on port 3000'));


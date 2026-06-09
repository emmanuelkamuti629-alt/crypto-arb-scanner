const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves everything in your 'public' folder

// Database Connection & Model
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('DB Error:', err));

const PaymentSchema = new mongoose.Schema({ 
    username: String, 
    txCode: String, 
    status: { type: String, default: 'pending' } 
});
const Payment = mongoose.model('Payment', PaymentSchema);

// API Route: Handle Payment Verification
app.post('/api/verify-payment', async (req, res) => {
    try {
        const payment = new Payment(req.body);
        await payment.save();
        res.status(200).json({ message: 'Request received' });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Socket.io: Real-time Chat
io.on('connection', (socket) => {
    console.log('User connected to chat');
    socket.on('chat message', (data) => {
        io.emit('chat message', data); // Broadcasts to everyone
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ArbiMine is running on port ${PORT}`);
});


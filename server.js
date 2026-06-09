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
app.use(express.static('public')); // This will serve your frontend files

// Database Connection
const dbURI = process.env.MONGODB_URI;
mongoose.connect(dbURI)
    .then(() => console.log('Successfully connected to MongoDB!'))
    .catch((err) => console.error('Database connection error:', err));

// Socket.io Real-time Chat Logic
io.on('connection', (socket) => {
    console.log('A user connected to the chat');

    socket.on('chat message', (data) => {
        // data should be { username: '...', message: '...' }
        io.emit('chat message', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Basic Routes
app.get('/', (req, res) => {
    res.send('ArbiMine Server is running!');
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ArbiMine backend active on port ${PORT}`);
});


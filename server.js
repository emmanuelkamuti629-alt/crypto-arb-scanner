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
// Serves your 'public' folder (where index.html, pro.html, etc. live)
app.use(express.static('public')); 

// Database Connection
const dbURI = process.env.MONGODB_URI;
mongoose.connect(dbURI)
    .then(() => console.log('Successfully connected to MongoDB!'))
    .catch((err) => console.error('Database connection error:', err));

// Chat Logic
io.on('connection', (socket) => {
    console.log('A user connected to the chat');

    // Listen for new messages
    socket.on('chat message', (data) => {
        // data format: { username: "Name", message: "Hello!" }
        io.emit('chat message', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ArbiMine backend active on port ${PORT}`);
});


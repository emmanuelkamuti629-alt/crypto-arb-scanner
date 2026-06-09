require('dotenv').config();
const express = require('express');
const axios = require('axios'); // Ensure you have this
const app = express();

app.use(express.static('public'));
app.use(express.json());

// Main Arbitrage Endpoint
app.get('/api/get-arbitrage-data', async (req, res) => {
    try {
        // REPLACE THIS URL with your actual data provider/scanner API
        // const response = await axios.get('https://api.your-scanner.com/live');
        
        // Mocking real-time data for ArbiMine
        const realTimeData = [
            { pair: 'MAJOR/USDT', profit: '1.6', buy: 'CoinEx', sell: 'ByBit', liquidity: '70' },
            { pair: 'NUM/USDT', profit: '1.3', buy: 'KuCoin', sell: 'Gate.io', liquidity: '147' },
            { pair: 'MANA/USDT', profit: '1.1', buy: 'OKX', sell: 'Poloniex', liquidity: '105' }
        ];
        
        res.json(realTimeData);
    } catch (err) {
        res.status(500).json({ error: "Scanner connection failed" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server live on ${PORT}`));


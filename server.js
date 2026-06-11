const express = require('express');
const ccxt = require('ccxt');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// CCXT exchanges
const exchanges = {
  mexc: new ccxt.mexc({ enableRateLimit: true }),
  bybit: new ccxt.bybit({ enableRateLimit: true }),
};

const opportunityHistory = {};
const COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK'];
const MIN_SPREAD = 1.0;

// --- ARBITRAGE SCANNER ROUTES ---

// 1. Main scan endpoint
app.get('/api/scan', async (req, res) => {
  try {
    const opportunities = [];
    await Promise.all(Object.values(exchanges).map(ex => ex.loadMarkets()));

    for (const coin of COINS) {
      const symbol = `${coin}/USDT`;
      try {
        const [mexcTicker, bybitTicker] = await Promise.all([
          exchanges.mexc.fetchTicker(symbol).catch(() => null),
          exchanges.bybit.fetchTicker(symbol).catch(() => null),
        ]);
        if (!mexcTicker ||!bybitTicker) continue;
        
        const scenarios = [
          { buy: 'MEXC', sell: 'BYBIT', buyPrice: mexcTicker.last, sellPrice: bybitTicker.last },
          { buy: 'BYBIT', sell: 'MEXC', buyPrice: bybitTicker.last, sellPrice: mexcTicker.last }
        ];

        for (const s of scenarios) {
          const spread = s.sellPrice - s.buyPrice;
          const spreadPercent = (spread / s.buyPrice) * 100;
          if (spreadPercent > MIN_SPREAD) {
            const key = `${coin}-${s.buy}-${s.sell}`;
            if (!opportunityHistory[key]) opportunityHistory[key] = { history: [] };
            opportunityHistory[key].history.push({ time: Date.now(), spread: spreadPercent });
            if (opportunityHistory[key].history.length > 100) opportunityHistory[key].history.shift();

            opportunities.push({
              coin, buyExchange: s.buy, sellExchange: s.sell,
              buyPrice: parseFloat(s.buyPrice.toFixed(4)),
              sellPrice: parseFloat(s.sellPrice.toFixed(4)),
              spread: parseFloat(spread.toFixed(4)),
              spreadPercent: parseFloat(spreadPercent.toFixed(2)),
              status: 'TRADEABLE',
              history: opportunityHistory[key]
            });
          }
        }
      } catch (err) { continue; }
    }
    opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);
    res.json({ opportunities, timestamp: Date.now(), count: opportunities.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Coin details for modal + graph
app.get('/api/coin-details', async (req, res) => {
  try {
    const { coin, buy, sell } = req.query;
    const symbol = `${coin}/USDT`;
    const [buyTicker, sellTicker] = await Promise.all([
      exchanges[buy.toLowerCase()].fetchTicker(symbol),
      exchanges[sell.toLowerCase()].fetchTicker(symbol)
    ]);
    const buyOB = await exchanges[buy.toLowerCase()].fetchOrderBook(symbol, 5);
    const sellOB = await exchanges[sell.toLowerCase()].fetchOrderBook(symbol, 5);
    
    res.json({
      coin, buyExchange: buy, sellExchange: sell,
      buyPrice: buyTicker.last, sellPrice: sellTicker.last,
      spread: sellTicker.last - buyTicker.last,
      spreadPercent: ((sellTicker.last - buyTicker.last) / buyTicker.last) * 100,
      volume24h: buyTicker.baseVolume,
      buyOrderBook: buyOB.bids.slice(0, 5),
      sellOrderBook: sellOB.asks.slice(0, 5),
      history: opportunityHistory[`${coin}-${buy}-${sell}`]?.history || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- YOUR EXISTING AUTH + M-PESA ROUTES ---
// Add your /api/pay and /api/me routes here from your old code

app.post('/api/pay', async (req, res) => {
  // Your M-Pesa STK push code here
  // Use req.body.phone, req.body.amount, req.body.plan
  res.json({ success: true, message: 'STK Push sent. Enter your M-Pesa PIN.' });
});

app.get('/api/me', (req, res) => {
  // Your token auth code here
  // Check req.headers.authorization
  res.json({ username: 'testuser' }); // Replace with real logic
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 ArbiMine running on ${PORT}`);
});

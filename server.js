const express = require('express');
const path = require('path');
const ccxt = require('ccxt');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public/
app.use(express.static('public'));
app.use(express.json());

// Persist history across requests
let opportunityHistory = {};

// Config
const COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK'];
const MIN_SPREAD = 1.0;

// API: Scan endpoint
app.get('/api/scan', async (req, res) => {
  try {
    const exchanges = {
      mexc: new ccxt.mexc({ enableRateLimit: true }),
      bybit: new ccxt.bybit({ enableRateLimit: true }),
    };

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
        const mexcPrice = mexcTicker.last;
        const bybitPrice = bybitTicker.last;
        if (!mexcPrice ||!bybitPrice) continue;

        const scenarios = [
          { buyExchange: 'MEXC', sellExchange: 'BYBIT', buyPrice: mexcPrice, sellPrice: bybitPrice },
          { buyExchange: 'BYBIT', sellExchange: 'MEXC', buyPrice: bybitPrice, sellPrice: mexcPrice }
        ];

        for (const s of scenarios) {
          const spread = s.sellPrice - s.buyPrice;
          const spreadPercent = (spread / s.buyPrice) * 100;
          if (spreadPercent > MIN_SPREAD) {
            opportunities.push({
              coin,
              buyExchange: s.buyExchange,
              sellExchange: s.sellExchange,
              buyPrice: parseFloat(s.buyPrice.toFixed(4)),
              sellPrice: parseFloat(s.sellPrice.toFixed(4)),
              spread: parseFloat(spread.toFixed(4)),
              spreadPercent: parseFloat(spreadPercent.toFixed(2)),
              status: 'TRADEABLE'
            });
          }
        }
      } catch (err) {
        console.error(`Error scanning ${coin}:`, err.message);
        continue;
      }
    }

    opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);

    // Track history for graph
    opportunities.forEach(opp => {
      const key = `${opp.coin}-${opp.buyExchange}-${opp.sellExchange}`;
      if (!opportunityHistory[key]) {
        opportunityHistory[key] = {
          firstSeen: Date.now(),
          firstSpread: opp.spreadPercent,
          history: [{ time: Date.now(), spread: opp.spreadPercent }]
        };
      } else {
        opportunityHistory[key].history.push({ time: Date.now(), spread: opp.spreadPercent });
        if (opportunityHistory[key].history.length > 100) {
          opportunityHistory[key].history.shift();
        }
      }
      opp.history = opportunityHistory[key];
    });

    res.json({ opportunities, timestamp: Date.now(), count: opportunities.length });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Scan failed', message: error.message });
  }
});

// API: Coin details endpoint
app.get('/api/coin-details', async (req, res) => {
  const { coin, buyExchange, sellExchange } = req.query;
  if (!coin ||!buyExchange ||!sellExchange) {
    return res.status(400).json({ error: 'Missing params' });
  }
  
  try {
    const buyEx = new ccxt[buyExchange.toLowerCase()]({ enableRateLimit: true });
    const sellEx = new ccxt[sellExchange.toLowerCase()]({ enableRateLimit: true });
    const symbol = `${coin}/USDT`;
    
    const [buyCurrencies, sellCurrencies, buyBook, sellBook] = await Promise.all([
      buyEx.fetchCurrencies().catch(() => ({})),
      sellEx.fetchCurrencies().catch(() => ({})), 
      buyEx.fetchOrderBook(symbol, 5).catch(() => ({ asks: [], bids: [] })),
      sellEx.fetchOrderBook(symbol, 5).catch(() => ({ asks: [], bids: [] }))
    ]);
    
    const buyCoinData = buyCurrencies;
    const sellCoinData = sellCurrencies;
    
    const getNetworks = (coinData) => {
      if (!coinData?.networks) return ['Unknown'];
      return Object.keys(coinData.networks).filter(n => coinData.networks[n].active);
    };
    
    res.json({
      buy: {
        exchange: buyExchange,
        depositEnabled: buyCoinData?.deposit?? true,
        withdrawEnabled: buyCoinData?.withdraw?? true,
        networks: getNetworks(buyCoinData),
        maxBuy: buyBook.asks?.[0]? buyBook.asks[0][0] * buyBook.asks[0][1] : 0,
        liquidity: buyBook.asks?.slice(0,5).reduce((sum, [p,q]) => sum + p*q, 0) || 0
      },
      sell: {
        exchange: sellExchange,
        depositEnabled: sellCoinData?.deposit?? true,
        withdrawEnabled: sellCoinData?.withdraw?? true,
        networks: getNetworks(sellCoinData),
        maxSell: sellBook.bids?.[0]? sellBook.bids[0][0] * sellBook.bids[0][1] : 0,
        liquidity: sellBook.bids?.slice(0,5).reduce((sum, [p,q]) => sum + p*q, 0) || 0
      }
    });
  } catch (error) {
    console.error('Coin details error:', error);
    res.status(500).json({ error: 'Failed to fetch details', message: error.message });
  }
});

// Fallback: serve index.html for any other route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

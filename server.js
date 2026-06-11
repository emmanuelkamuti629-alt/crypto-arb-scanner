const express = require('express');
const ccxt = require('ccxt');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const exchanges = {
  mexc: new ccxt.mexc({ enableRateLimit: true }),
  bybit: new ccxt.bybit({ enableRateLimit: true }),
};

const COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK'];
const MIN_SPREAD = 1.0;

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
        if (!mexcTicker || !bybitTicker) continue;
        
        const scenarios = [
          { buy: 'MEXC', sell: 'BYBIT', buyPrice: mexcTicker.last, sellPrice: bybitTicker.last },
          { buy: 'BYBIT', sell: 'MEXC', buyPrice: bybitTicker.last, sellPrice: mexcTicker.last }
        ];

        for (const s of scenarios) {
          const spread = s.sellPrice - s.buyPrice;
          const spreadPercent = (spread / s.buyPrice) * 100;
          if (spreadPercent > MIN_SPREAD) {
            opportunities.push({
              coin, buyExchange: s.buy, sellExchange: s.sell,
              buyPrice: parseFloat(s.buyPrice.toFixed(4)),
              sellPrice: parseFloat(s.sellPrice.toFixed(4)),
              spread: parseFloat(spread.toFixed(4)),
              spreadPercent: parseFloat(spreadPercent.toFixed(2)),
              status: 'TRADEABLE'
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

// Details: deposit/withdraw + networks + liquidity
app.get('/api/coin-details', async (req, res) => {
  try {
    const { coin, buy, sell } = req.query;
    const symbol = `${coin}/USDT`;
    
    const buyEx = exchanges[buy.toLowerCase()];
    const sellEx = exchanges[sell.toLowerCase()];
    
    await Promise.all([buyEx.loadMarkets(), sellEx.loadMarkets()]);
    
    const [buyTicker, sellTicker, buyCurrency, sellCurrency] = await Promise.all([
      buyEx.fetchTicker(symbol),
      sellEx.fetchTicker(symbol),
      buyEx.currency(coin),
      sellEx.currency(coin)
    ]);
    
    const buyOB = await buyEx.fetchOrderBook(symbol, 10);
    const sellOB = await sellEx.fetchOrderBook(symbol, 10);
    
    // Calculate liquidity: sum of top 10 bids/asks in USDT
    const buyLiquidity = buyOB.bids.slice(0,10).reduce((sum, [price, amount]) => sum + price * amount, 0);
    const sellLiquidity = sellOB.asks.slice(0,10).reduce((sum, [price, amount]) => sum + price * amount, 0);
    
    res.json({
      coin, buyExchange: buy, sellExchange: sell,
      buyPrice: buyTicker.last, 
      sellPrice: sellTicker.last,
      spread: sellTicker.last - buyTicker.last,
      spreadPercent: ((sellTicker.last - buyTicker.last) / buyTicker.last) * 100,
      volume24h: buyTicker.baseVolume,
      
      buyStatus: {
        deposit: buyCurrency.deposit,  // true/false
        withdraw: buyCurrency.withdraw, // true/false
        networks: buyCurrency.networks || {}
      },
      sellStatus: {
        deposit: sellCurrency.deposit,
        withdraw: sellCurrency.withdraw,
        networks: sellCurrency.networks || {}
      },
      liquidity: {
        buy: parseFloat(buyLiquidity.toFixed(2)),
        sell: parseFloat(sellLiquidity.toFixed(2))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Your /api/pay and /api/me routes here

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Running on ${PORT}`));

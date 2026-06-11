import ccxt from 'ccxt';

// Persist history across function calls on same Vercel instance
const opportunityHistory = global.opportunityHistory || {};
global.opportunityHistory = opportunityHistory;

// Config: add/remove coins here
const COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK'];
const MIN_SPREAD = 1.0; // Only show opportunities > 1%

export default async function handler(req, res) {
  if (req.method!== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Init exchanges
    const exchanges = {
      mexc: new ccxt.mexc({ enableRateLimit: true }),
      bybit: new ccxt.bybit({ enableRateLimit: true }),
    };

    const opportunities = [];

    // 2. Load markets once per exchange
    await Promise.all(Object.values(exchanges).map(ex => ex.loadMarkets()));

    // 3. Scan each coin across exchange pairs
    for (const coin of COINS) {
      const symbol = `${coin}/USDT`;
      
      try {
        // Fetch tickers in parallel
        const [mexcTicker, bybitTicker] = await Promise.all([
          exchanges.mexc.fetchTicker(symbol).catch(() => null),
          exchanges.bybit.fetchTicker(symbol).catch(() => null),
        ]);

        if (!mexcTicker ||!bybitTicker) continue;

        const mexcPrice = mexcTicker.last;
        const bybitPrice = bybitTicker.last;

        if (!mexcPrice ||!bybitPrice) continue;

        // Check both directions
        const scenarios = [
          {
            buyExchange: 'MEXC',
            sellExchange: 'BYBIT', 
            buyPrice: mexcPrice,
            sellPrice: bybitPrice
          },
          {
            buyExchange: 'BYBIT',
            sellExchange: 'MEXC',
            buyPrice: bybitPrice,
            sellPrice: mexcPrice
          }
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
              status: 'TRADEABLE' // You can add deposit/withdraw checks here later
            });
          }
        }
      } catch (err) {
        console.error(`Error scanning ${coin}:`, err.message);
        continue;
      }
    }

    // 4. Sort by highest spread first
    opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);

    // 5. TRACK HISTORY FOR GRAPH ↓↓↓
    opportunities.forEach(opp => {
      const key = `${opp.coin}-${opp.buyExchange}-${opp.sellExchange}`;
      
      if (!opportunityHistory[key]) {
        opportunityHistory[key] = {
          firstSeen: Date.now(),
          firstSpread: opp.spreadPercent,
          history: [{ time: Date.now(), spread: opp.spreadPercent }]
        };
      } else {
        opportunityHistory[key].history.push({ 
          time: Date.now(), 
          spread: opp.spreadPercent 
        });
        // Keep last 100 points only to prevent memory bloat
        if (opportunityHistory[key].history.length > 100) {
          opportunityHistory[key].history.shift();
        }
      }
      
      // Attach to opportunity so frontend gets it
      opp.history = opportunityHistory[key];
    });
    // ↑↑↑ END HISTORY TRACKING

    // 6. Return to frontend
    res.status(200).json({ 
      opportunities,
      timestamp: Date.now(),
      count: opportunities.length
    });

  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ 
      error: 'Scan failed', 
      message: error.message 
    });
  }
}

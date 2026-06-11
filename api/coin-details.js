const ccxt = require('ccxt');

const exchanges = {
  mexc: new ccxt.mexc({ enableRateLimit: true }),
  bybit: new ccxt.bybit({ enableRateLimit: true }),
};

module.exports = async (req, res) => {
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
    
    const buyLiquidity = buyOB.bids.slice(0,10).reduce((sum, [price, amount]) => sum + price * amount, 0);
    const sellLiquidity = sellOB.asks.slice(0,10).reduce((sum, [price, amount]) => sum + price * amount, 0);
    
    res.json({
      coin, buyExchange: buy, sellExchange: sell,
      buyPrice: buyTicker.last, sellPrice: sellTicker.last,
      spread: sellTicker.last - buyTicker.last,
      spreadPercent: ((sellTicker.last - buyTicker.last) / buyTicker.last) * 100,
      volume24h: buyTicker.baseVolume,
      buyStatus: {
        deposit: buyCurrency.deposit,
        withdraw: buyCurrency.withdraw,
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
};

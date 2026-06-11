import ccxt from 'ccxt';

export default async function handler(req, res) {
  const { coin, buyExchange, sellExchange } = req.query;
  
  if (!coin ||!buyExchange ||!sellExchange) {
    return res.status(400).json({ error: 'Missing params: coin, buyExchange, sellExchange' });
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
    
    // Get active networks for the coin
    const getNetworks = (coinData) => {
      if (!coinData?.networks) return ['Unknown'];
      return Object.keys(coinData.networks).filter(n => coinData.networks[n].active);
    };
    
    // Calc liquidity from top 5 levels
    const calcLiquidity = (book) => {
      return book.asks?.slice(0,5).reduce((sum, [price, qty]) => sum + price * qty, 0) || 0;
    };
    
    res.status(200).json({
      buy: {
        exchange: buyExchange,
        depositEnabled: buyCoinData?.deposit?? true,
        withdrawEnabled: buyCoinData?.withdraw?? true,
        networks: getNetworks(buyCoinData),
        maxBuy: buyBook.asks?.[0]? buyBook.asks[0][0] * buyBook.asks[0][1] : 0,
        liquidity: calcLiquidity(buyBook)
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
    res.status(500).json({ 
      error: 'Failed to fetch details',
      message: error.message 
    });
  }
}

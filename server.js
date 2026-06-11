const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const sessions = {};

function hashPassword(pwd) { return crypto.createHash('sha256').update(pwd).digest('hex'); }
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// 15 EXCHANGES
const EXCHANGES = {
  mexc: 'https://api.mexc.com/api/v3/ticker/24hr',
  kucoin: 'https://api.kucoin.com/api/v1/market/allTickers',
  bitmart: 'https://api-cloud.bitmart.com/spot/v1/ticker',
  bitget: 'https://api.bitget.com/api/spot/v1/market/tickers',
  lbank: 'https://api.lbank.info/v1/ticker.do?symbol=all',
  coinex: 'https://api.coinex.com/v1/market/ticker/all',
  gateio: 'https://api.gateio.ws/api/v4/spot/tickers',
  okx: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
  bybit: 'https://api.bybit.com/v5/market/tickers?category=spot',
  htx: 'https://api.huobi.pro/market/tickers',
  bitfinex: 'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',
  poloniex: 'https://api.poloniex.com/markets/ticker24h',
  kraken: 'https://api.kraken.com/0/public/Ticker?pair=ALL'
};

const MIN_PROFIT = 0.0;
const MAX_PROFIT = 100.0;
const MAX_CHECKS = 70; // Increased to 70
const statusCache = {};
const CACHE_TIME = 5 * 60 * 1000;

// ... (Keep existing AUTH routes as they are)

async function safeGet(url, name) {
  try { return (await axios.get(url, { timeout: 10000 })).data; } 
  catch (e) { console.log(`${name} FAILED:`, e.message); return null; }
}

// ... (Keep checkWithdrawDeposit and getMaxTradeable as they are)

function extractSymbolAndData(symbol, exchange, tickerData) {
  let sym = null, price = 0, volume = 0;

  // Existing logic...
  if (exchange === 'mexc' && symbol.endsWith('USDT')) { sym = symbol.replace('USDT', ''); price = parseFloat(tickerData.lastPrice); volume = parseFloat(tickerData.quoteVolume); }
  else if (exchange === 'kucoin' && symbol.endsWith('-USDT')) { sym = symbol.replace('-USDT', ''); price = parseFloat(tickerData.last); volume = parseFloat(tickerData.volValue); }
  else if (exchange === 'bitmart' && symbol.endsWith('_USDT')) { sym = symbol.replace('_USDT', ''); price = parseFloat(tickerData.last_price); volume = parseFloat(tickerData.quote_volume); }
  else if (exchange === 'bitget' && symbol.endsWith('USDT')) { sym = symbol.replace('USDT', ''); price = parseFloat(tickerData.close); volume = parseFloat(tickerData.usdtVol); }
  else if (exchange === 'lbank' && symbol.endsWith('_usdt')) { sym = symbol.replace('_usdt', '').toUpperCase(); price = parseFloat(tickerData.ticker.latest); volume = parseFloat(tickerData.ticker.turnover); }
  else if (exchange === 'coinex' && symbol.endsWith('USDT')) { sym = symbol.replace('USDT', ''); price = parseFloat(tickerData.last); volume = parseFloat(tickerData.vol) * price; }
  else if (exchange === 'gateio' && symbol.endsWith('_USDT')) { sym = symbol.replace('_USDT', ''); price = parseFloat(tickerData.last); volume = parseFloat(tickerData.quote_volume); }
  else if (exchange === 'okx' && symbol.endsWith('-USDT')) { sym = symbol.replace('-USDT', ''); price = parseFloat(tickerData.last); volume = parseFloat(tickerData.volCcy24h) * price; }
  else if (exchange === 'bybit' && symbol.endsWith('USDT')) { sym = symbol.replace('USDT', ''); price = parseFloat(tickerData.lastPrice); volume = parseFloat(tickerData.turnover24h); }
  else if (exchange === 'htx' && symbol.endsWith('usdt')) { sym = symbol.replace('usdt', '').toUpperCase(); price = parseFloat(tickerData.close); volume = parseFloat(tickerData.vol) * price; }
  
  // New Exchange Parsing
  else if (exchange === 'bitfinex' && symbol.startsWith('t') && symbol.endsWith('UST')) { sym = symbol.replace('t', '').replace('UST', ''); price = parseFloat(tickerData[7]); volume = parseFloat(tickerData[8]); }
  else if (exchange === 'poloniex' && symbol.endsWith('_USDT')) { sym = symbol.replace('_USDT', ''); price = parseFloat(tickerData.last); volume = parseFloat(tickerData.quoteVolume); }
  else if (exchange === 'kraken' && symbol.endsWith('USD')) { sym = symbol.replace('USD', ''); price = parseFloat(tickerData.c[0]); volume = parseFloat(tickerData.v[1]); }

  return sym ? { symbol: sym, price, volume } : null;
}

// ... (Keep the rest of the /api/arbs route)

app.listen(PORT, () => { console.log(`🚀 ArbiMine running on port ${PORT}`); });


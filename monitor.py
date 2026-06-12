import requests
import time
import threading
from datetime import datetime

# Change this to your dashboard API endpoint
API_URL = "http://localhost:3000/api/opportunities"

# Public ticker endpoints - no API key, no auth needed
APIS = {
    'mexc': 'https://api.mexc.com/api/v3/ticker/bookTicker?symbol={}USDT',
    'bybit': 'https://api.bybit.com/v5/market/tickers?category=spot&symbol={}USDT',
    'gateio': 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair={}_USDT',
    'bitget': 'https://api.bitget.com/api/v2/spot/market/tickers?symbol={}USDT',
    'kucoin': 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol={}-USDT',
}

# Add/remove pairs here
SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE']

def get_price(ex, symbol):
    try:
        url = APIS[ex].format(symbol)
        r = requests.get(url, timeout=5).json()

        if ex == 'mexc':
            return float(r['bidPrice']), float(r['askPrice'])
        elif ex == 'bybit':
            d = r['result']['list'][0]
            return float(d['bid1Price']), float(d['ask1Price'])
        elif ex == 'gateio':
            d = r[0]
            return float(d['highest_bid']), float(d['lowest_ask'])
        elif ex == 'bitget':
            d = r['data'][0]
            return float(d['bidPr']), float(d['askPr'])
        elif ex == 'kucoin':
            d = r['data']
            return float(d['bestBid']), float(d['bestAsk'])
    except Exception as e:
        # print(f"{ex} {symbol} error: {e}")
        return None, None

def post_opp(data):
    try:
        requests.post(API_URL, json=data, timeout=3)
    except:
        pass # Dashboard might be down, keep scanning

def scan_symbol(symbol):
    prices = {}
    for ex in APIS:
        bid, ask = get_price(ex, symbol)
        if bid and ask:
            prices[ex] = {'bid': bid, 'ask': ask}

    # Find all profitable spreads
    for buy_ex in prices:
        for sell_ex in prices:
            if buy_ex == sell_ex:
                continue

            buy_price = prices[buy_ex]['ask'] # We buy at ask
            sell_price = prices[sell_ex]['bid'] # We sell at bid
            if sell_price <= buy_price:
                continue

            profit = (sell_price - buy_price) / buy_price * 100
            if not (0.2 <= profit <= 100): # Filter noise and bad data
                continue

            opp = {
                'pair': f'{symbol}/USDT',
                'profit': round(profit, 2),
                'buyExchange': buy_ex,
                'sellExchange': sell_ex,
                'buyPrice': buy_price,
                'sellPrice': sell_price,
                'timestamp': datetime.utcnow().isoformat(),
                'tradable': False, # Can't check wallets without ccxt
                'buyStatus': {'deposit': False, 'withdraw': False, 'networks': []},
                'sellStatus': {'deposit': False, 'withdraw': False, 'networks': []}
            }
            post_opp(opp)
            print(f"{datetime.now().strftime('%H:%M:%S')} {symbol}/USDT: {profit:.2f}% {buy_ex}->{sell_ex} | Buy ${buy_price:.4f} Sell ${sell_price:.4f}")

print(f"Starting monitor: {SYMBOLS} on {list(APIS.keys())}")
print(f"Posting to: {API_URL}")
print("-" * 60)

while True:
    start = time.time()
    threads = []
    for symbol in SYMBOLS:
        t = threading.Thread(target=scan_symbol, args=(symbol,))
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

    elapsed = time.time() - start
    sleep_time = max(0, 10 - elapsed) # 10s loop total
    time.sleep(sleep_time)

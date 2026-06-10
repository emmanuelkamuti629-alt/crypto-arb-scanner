import ccxt.async_support as ccxt
import asyncio

# Define your exchanges
exchanges = {
    'mexc': ccxt.mexc(),
    'bitmart': ccxt.bitmart(),
    'bitget': ccxt.bitget(),
    'kucoin': ccxt.kucoin(),
    'gateio': ccxt.gateio(),
}

async def fetch_price(exchange, symbol):
    try:
        ticker = await exchange.fetch_ticker(symbol)
        return exchange.id, ticker['bid'], ticker['ask']
    except Exception as e:
        return exchange.id, None, None

async def monitor():
    symbol = 'BTC/USDT'
    print(f"Monitoring {symbol}...")
    
    while True:
        tasks = [fetch_price(ex, symbol) for ex in exchanges.values()]
        results = await asyncio.gather(*tasks)
        
        # Simple printout for testing
        for name, bid, ask in results:
            if bid and ask:
                print(f"{name}: Bid={bid}, Ask={ask}")
        
        await asyncio.sleep(5) # Wait 5 seconds before next poll

if __name__ == "__main__":
    asyncio.run(monitor())


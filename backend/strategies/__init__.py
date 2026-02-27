"""
Import all strategy modules here so they register themselves via @register.
To add a new strategy: create the file, then add the import below.
"""
from strategies import btc_15m  # noqa: F401

# Example future strategies:
# from strategies import btc_arbitrage      # noqa: F401
# from strategies import eth_15m            # noqa: F401
# from strategies import macro_sentiment    # noqa: F401

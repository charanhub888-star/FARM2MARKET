"""Market price provider seam.

The demo provider reads cached rows from SQLite. A production provider can
implement the same interface and use MARKET_API_URL/KEY without changing the
routes or frontend.
"""


class MarketPriceProvider:
    def get_prices(self, db, crop=None):
        raise NotImplementedError


class CachedMarketPriceProvider(MarketPriceProvider):
    def get_prices(self, db, crop=None):
        sql, args = "SELECT * FROM market_prices", []
        if crop:
            sql += " WHERE crop=?"
            args.append(crop)
        return db.execute(sql + " ORDER BY crop", args).fetchall()

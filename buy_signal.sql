-- 5分間の上昇ローソク足
INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (1771053300, 4748.00, 4757.33, 4747.78, 4755.58, 65.5);
INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (1771053360, 4755.58, 4762.32, 4755.43, 4760.61, 65.5);
INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (1771053420, 4760.61, 4770.46, 4759.61, 4768.57, 65.5);
INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (1771053480, 4768.57, 4779.39, 4767.93, 4777.71, 65.5);
INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (1771053540, 4777.71, 4786.04, 4777.51, 4785.63, 65.5);
INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (1771053600, 4785.63, 4792.31, 4785.47, 4790.81, 65.5);

-- 買いサイン（5分後）
INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi) 
SELECT id, 1771053600, 'BUY', 4790.81, 4795.81, 0, 65.5 
FROM gold10_candles WHERE timestamp = 1771053600;

@echo off
REM TSUMITSUMI 価格定期更新（Windowsタスクスケジューラから日次実行）
REM gears_catalog + asin_map の価格/画像を Creators API で再取得して書き戻す
"C:\Program Files\nodejs\node.exe" "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\paapi-refresh-prices.js" --apply >> "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\refresh-cron.log" 2>&1

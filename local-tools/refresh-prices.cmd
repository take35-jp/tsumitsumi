@echo off
REM TSUMITSUMI daily price/image refresh (run by Windows Task Scheduler)
REM Re-fetches price/image for known ASINs and writes back to gears_catalog + asin_map
"C:\Program Files\nodejs\node.exe" "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\paapi-refresh-prices.js" --apply >> "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\refresh-cron.log" 2>&1

@echo off
REM TSUMITSUMI Instagram long-lived token refresh (run by Windows Task Scheduler, monthly)
REM Extends the 60-day IG access token and rewrites local-tools/.env
"C:\Program Files\nodejs\node.exe" "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\social\refresh-ig-token.js" >> "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\social\social-cron.log" 2>&1

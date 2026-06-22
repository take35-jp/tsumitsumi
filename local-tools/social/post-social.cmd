@echo off
REM TSUMITSUMI Instagram auto-post (run by Windows Task Scheduler, e.g. twice a week)
REM Posts the next un-posted TIPS article as a carousel.
REM NOTE: carousel images for the target slug must already be live on Vercel
REM       (committed & pushed). gen-carousel runs locally at article-publish time.
"C:\Program Files\nodejs\node.exe" "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\social\run-next.js" >> "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\social\social-cron.log" 2>&1

# PA-API eligibility hourly poll loop
# Runs paapi-poll-once.js every hour until ELIGIBLE (exit 0)

$POLL_SCRIPT = "C:\Users\taker\Documents\GitHub\tsumitsumi\.claude\worktrees\flamboyant-solomon-aac362\local-tools\paapi-poll-once.js"
$LOG_FILE    = "C:\Users\taker\Documents\GitHub\tsumitsumi\local-tools\paapi-poll.log"

$count = 0
while ($true) {
    $count++
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm"
    $output = node $POLL_SCRIPT 2>&1
    $exit = $LASTEXITCODE

    if ($exit -eq 0) {
        $line = "[$ts] poll #${count}: ELIGIBLE! PA-API ready (exit 0)"
        Add-Content -Path $LOG_FILE -Value $line
        Write-Host $line
        break
    } elseif ($exit -eq 42) {
        $line = "[$ts] poll #${count}: not-yet (exit 42)"
        Add-Content -Path $LOG_FILE -Value $line
        Write-Host $line
    } else {
        $line = "[$ts] poll #${count}: ERROR - $output (exit $exit)"
        Add-Content -Path $LOG_FILE -Value $line
        Write-Host $line
    }

    Start-Sleep -Seconds 3600
}

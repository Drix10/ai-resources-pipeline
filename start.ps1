# Start Chrome with remote debugging if not already running
$chromeProcess = Get-Process chrome -ErrorAction SilentlyContinue
if (-not $chromeProcess) {
    Write-Host "Starting Chrome with remote debugging..." -ForegroundColor Green
    Start-Process chrome -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$env:LOCALAPPDATA\Google\Chrome\User Data","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding"
    Start-Sleep -Seconds 3
} else {
    Write-Host "Chrome is already running" -ForegroundColor Yellow
}

# Start the Node.js application
Write-Host "Starting application..." -ForegroundColor Green
node index.js

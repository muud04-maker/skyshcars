Write-Host "Sky Cars representative photo workflow" -ForegroundColor Cyan
Write-Host "1/3 Installing dependencies if needed..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "2/3 Downloading model photos from the configured photo-pack sources..." -ForegroundColor Yellow
Push-Location tools/photo-pack
node download_5_photos.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "download_5_photos.mjs failed" }
Pop-Location

Write-Host "3/3 Importing downloaded photos into public/uploads/vehicles ..." -ForegroundColor Yellow
node tools/photo-pack/import_to_public.mjs
if ($LASTEXITCODE -ne 0) { throw "import_to_public.mjs failed" }

Write-Host "Representative photo import complete. Start the site and confirm the catalog cards now show photos." -ForegroundColor Green

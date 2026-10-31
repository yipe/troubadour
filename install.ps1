<#
Sets up Troubadour on Windows from a fresh clone: checks prerequisites, installs the Python and web
packages and builds the UI. Safe to re-run. install.sh is the macOS / Linux twin; keep them in step.

  .\install.ps1          run the app: packages + built UI, then `yarn start`
  .\install.ps1 -Dev     develop on it: all Python groups + the test browser
  .\install.ps1 -Check   only report missing prerequisites and how to fix them
#>
param([switch]$Dev, [switch]$Check)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Step($text) { Write-Host "`n==> $text" }
function Run {
    # Native commands don't throw on failure; stop at the first one that fails.
    $command, $rest = $args
    & $command @rest
    if ($LASTEXITCODE -ne 0) { throw "install.ps1: '$($args -join ' ')' failed (exit $LASTEXITCODE)." }
}

# Collect every problem before fixing any, so one run lists them all.
$missing = @()   # "  - tool: why" lines
$packages = @()  # winget ids that fix them
$blocked = @()   # problems this script can't fix
$after = @()     # fixes that run after the packages

if (-not (Have uv)) { $missing += "  - uv: installs Python 3.12 and Troubadour's packages"; $packages += 'astral-sh.uv' }
if (-not (Have ffmpeg)) { $missing += '  - ffmpeg: decodes audio files'; $packages += 'Gyan.FFmpeg' }
if (Have node) {
    $major = [int](node -p 'process.versions.node.split(".")[0]')
    if ($major -lt 24) { $blocked += "  - Node $major is too old; Troubadour needs Node 24 or newer (winget upgrade OpenJS.NodeJS.LTS)." }
} else {
    $missing += '  - node: builds the web UI (Node 24 or newer)'
    $packages += 'OpenJS.NodeJS.LTS'
}
# Node 25+ no longer ships Corepack, which provides the pinned Yarn and pnpm.
if (-not (Have corepack)) { $missing += '  - corepack: runs the pinned Yarn and pnpm'; $after += 'npm install -g corepack' }
if ($packages -and -not (Have winget)) {
    $blocked += '  - winget (App Installer) is missing: install it from the Microsoft Store, then run .\install.ps1 again.'
}

if ($missing -or $blocked) {
    [Console]::Error.WriteLine("Missing prerequisites:`n" + (($missing + $blocked) -join "`n"))
    $fixes = @($packages | ForEach-Object { "winget install --id $_ -e --accept-source-agreements --accept-package-agreements" }) + $after
    if ($fixes) { [Console]::Error.WriteLine("`nFix with:`n  " + ($fixes -join "`n  ")) }
    # Install only when someone is there to say yes: never surprise CI or a piped run.
    if ($blocked -or $Check -or [Console]::IsInputRedirected) { exit 1 }
    $answer = Read-Host "`nRun that now? [Y/n]"
    if ($answer -match '^[nN]') { exit 1 }
    foreach ($id in $packages) { Run winget install --id $id -e --accept-source-agreements --accept-package-agreements }
    # winget changes PATH for new shells only; pick it up here.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($after) { Run npm install -g corepack }
}
if ($Check) { Write-Host 'All prerequisites found.'; exit 0 }

$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'

# The web scripts call `pnpm` and the root ones `yarn` by name: Corepack's shims provide both, at the versions
# package.json pins. Next to node when that's writable, else in a per-user folder (Program Files needs admin).
if (-not ((Have pnpm) -and (Have yarn))) {
    corepack enable 2>$null
    if ($LASTEXITCODE -ne 0) {
        $shims = Join-Path $env:LOCALAPPDATA 'Troubadour\bin'
        Run corepack enable --install-directory $shims
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (($userPath -split ';') -notcontains $shims) {
            [Environment]::SetEnvironmentVariable('Path', "$shims;$userPath", 'User')
            Write-Host "Put Yarn and pnpm in $shims and added it to your PATH (new terminals pick it up)."
        }
        $env:Path = "$shims;$env:Path"
    }
}

Step 'Python packages (uv sync; the first run downloads PyTorch and Whisper, a few minutes)'
Push-Location backend
# --inexact: keep the extra groups a developer may have installed with -Dev.
if ($Dev) { Run uv sync --all-groups } else { Run uv sync --frozen --inexact }
Pop-Location

# From web\, where packageManager pins pnpm.
Step 'Web packages (pnpm install)'
Push-Location web
Run pnpm install
if ($Dev) {
    Step 'Test browser (Playwright Chromium, for the browser tests in yarn check)'
    Run pnpm -C app exec playwright install chromium
} else {
    Step 'Building the web UI'
    Run pnpm build
}
Pop-Location

if ($Dev) {
    Write-Host "`nReady. yarn dev (API + Vite), yarn check before every commit. See AGENTS.md."
} else {
    Write-Host @"

Ready. To start:
  1. A Hugging Face token with access to pyannote/speaker-diarization-community-1 (see README).
  2. Optional: LM Studio serving on port 1235, or pick a hosted model later in Models.
  3. `$env:HF_TOKEN = 'hf_...'; yarn start   then open http://127.0.0.1:8765
"@
}

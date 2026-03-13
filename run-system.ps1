# =============================================================================
# ENTERPRISE MASTER RUNNER: FeedFactory Pro Full-Stack Execution System
# Version: 2026.03 - Phase 2 Ready (Multi-User & Cloud Sync)
# Author: Full-Stack Enterprise Architect (Fellow Grade)
# =============================================================================

# Set error handling
$ErrorActionPreference = "Stop"

# Configuration
$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND_DIR = Join-Path $PROJECT_ROOT "backend"
$FRONTEND_DIR = $PROJECT_ROOT
$PRISMA_DIR = Join-Path $PROJECT_ROOT "prisma"

# =============================================================================
# Helper Functions
# =============================================================================

function Log-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Log-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Log-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Log-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Log-Step {
    param([string]$Message)
    Write-Host "[STEP] $Message" -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Command)
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        Log-Error "$Command is not installed. Please install it first."
        exit 1
    }
}

function Test-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        Log-Error "Directory not found: $Path"
        exit 1
    }
}

# =============================================================================
# Pre-flight Checks
# =============================================================================

function Invoke-PreflightChecks {
    Log-Step "Running pre-flight checks..."
    
    # Check Node.js
    Test-Command "node"
    $NODE_VERSION = node -v
    Log-Success "Node.js installed: $NODE_VERSION"
    
    # Check npm
    Test-Command "npm"
    $NPM_VERSION = npm -v
    Log-Success "npm installed: $NPM_VERSION"
    
    # Check required directories
    Test-Directory $BACKEND_DIR
    Test-Directory (Join-Path $FRONTEND_DIR "src")
    Test-Directory $PRISMA_DIR
    Log-Success "All required directories found"
    
    # Check if node_modules exist
    if (-not (Test-Path (Join-Path $PROJECT_ROOT "node_modules"))) {
        Log-Warning "Frontend dependencies not installed. Running npm install..."
        npm install
    }
    
    if (-not (Test-Path (Join-Path $BACKEND_DIR "node_modules"))) {
        Log-Warning "Backend dependencies not installed. Running npm install in backend..."
        Set-Location $BACKEND_DIR
        npm install
        Set-Location $PROJECT_ROOT
    }
    
    # Check if concurrently is installed
    $concurrentlyPath = Join-Path $PROJECT_ROOT "node_modules\.bin\concurrently"
    if (-not (Test-Path $concurrentlyPath)) {
        Log-Warning "concurrently not found. Installing as dev dependency..."
        npm install --save-dev concurrently
    }
    
    Log-Success "Pre-flight checks completed"
}

# =============================================================================
# Database Synchronization
# =============================================================================

function Invoke-DatabaseSync {
    Log-Step "Step 1: Syncing Database Schema (Prisma)..."
    
    # Generate Prisma Client
    Log-Info "Generating Prisma Client..."
    npx prisma generate
    
    # Run migrations (development mode)
    Log-Info "Running database migrations..."
    npx prisma migrate dev --name sync
    
    # Seed database if seed file exists
    $seedFile = Join-Path $PRISMA_DIR "seed.ts"
    if (Test-Path $seedFile) {
        Log-Info "Seeding database..."
        npx prisma db seed
    }
    
    Log-Success "Database synchronization completed"
}

# =============================================================================
# Cache Clearing
# =============================================================================

function Invoke-CacheClear {
    Log-Step "Step 2: Clearing temporary build artifacts..."
    
    # Remove frontend build cache
    $frontendDist = Join-Path $PROJECT_ROOT "dist"
    if (Test-Path $frontendDist) {
        Remove-Item -Recurse -Force $frontendDist
        Log-Info "Removed frontend dist/"
    }
    
    # Remove backend build cache
    $backendDist = Join-Path $BACKEND_DIR "dist"
    if (Test-Path $backendDist) {
        Remove-Item -Recurse -Force $backendDist
        Log-Info "Removed backend dist/"
    }
    
    # Remove Vite cache
    $viteCache = Join-Path $PROJECT_ROOT "node_modules\.vite"
    if (Test-Path $viteCache) {
        Remove-Item -Recurse -Force $viteCache
        Log-Info "Cleared Vite cache"
    }
    
    # Remove Prisma cache
    $prismaCache = Join-Path $PRISMA_DIR ".prisma"
    if (Test-Path $prismaCache) {
        Remove-Item -Recurse -Force $prismaCache
        Log-Info "Cleared Prisma cache"
    }
    
    Log-Success "Cache clearing completed"
}

# =============================================================================
# Health Check
# =============================================================================

function Invoke-HealthCheck {
    Log-Step "Running health check..."
    
    $BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "3001" }
    # Wait for backend to start
    Log-Info "Waiting for backend to be ready (max 30 seconds)..."
    $MAX_ATTEMPTS = 30
    $ATTEMPT = 0
    
    while ($ATTEMPT -lt $MAX_ATTEMPTS) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:${BackendPort}/api/health" -UseBasicParsing -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Log-Success "Backend health check passed: $($response.Content)"
                return $true
            }
        } catch {
            # Continue waiting
        }
        $ATTEMPT++
        Start-Sleep -Seconds 1
    }
    
    Log-Error "Backend health check failed after $MAX_ATTEMPTS attempts"
    return $false
}

# =============================================================================
# System Launch
# =============================================================================

function Invoke-SystemLaunch {
    Log-Step "Step 3: Launching Backend & Frontend in Watch Mode..."
    $BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "3001" }
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Cyan
    Write-Host "  FeedFactory Pro Enterprise System" -ForegroundColor Cyan
    Write-Host "  - Backend:  http://localhost:${BackendPort}" -ForegroundColor White
    Write-Host "  - Frontend: http://localhost:5173" -ForegroundColor White
    Write-Host "  - Health:   http://localhost:${BackendPort}/api/health" -ForegroundColor White
    Write-Host "=============================================================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Use concurrently to run both servers with colored output
    $concurrentlyPath = Join-Path $PROJECT_ROOT "node_modules\.bin\concurrently"
    
    & $concurrentlyPath `
        --prefix "[{name}]" `
        --names "BACKEND,FRONTEND" `
        --colors "bgBlue,bgGreen" `
        --kill-others `
        --kill-others-on-fail `
        --restart-tries 3 `
        --restart-delay 2000 `
        "cd '$BACKEND_DIR' && npm run start:dev" `
        "npm run dev"
}

# =============================================================================
# Main Execution
# =============================================================================

function Main {
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Cyan
    Write-Host "  🏭 FeedFactory Pro Enterprise System - Master Runner" -ForegroundColor Cyan
    Write-Host "  Version: 2026.03 | Phase 2 Ready (Multi-User & Cloud Sync)" -ForegroundColor Cyan
    Write-Host "=============================================================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Parse command line arguments
    $command = $args[0]
    if (-not $command) { $command = "full" }
    
    switch ($command) {
        "codespaces" {
            Log-Info "Running system startup for GitHub Codespaces..."
            if (-not $env:BACKEND_PORT) { $env:BACKEND_PORT = "3001" }
            Log-Info "Backend port: $($env:BACKEND_PORT) | Frontend port: 5173"
            Log-Info "Ensure ports $($env:BACKEND_PORT) and 5173 are forwarded in your Codespace."
            Invoke-PreflightChecks
            Invoke-CacheClear
            Invoke-SystemLaunch
        }
        "full" {
            Log-Info "Running FULL system startup..."
            Invoke-PreflightChecks
            Invoke-DatabaseSync
            Invoke-CacheClear
            Invoke-SystemLaunch
        }
        "no-db" {
            Log-Info "Running system startup WITHOUT database sync..."
            Invoke-PreflightChecks
            Invoke-CacheClear
            Invoke-SystemLaunch
        }
        "health" {
            Log-Info "Running health check only..."
            Invoke-HealthCheck
        }
        "clean" {
            Log-Info "Running cache clean only..."
            Invoke-CacheClear
            Log-Success "Cache cleaned successfully"
        }
        "help" {
            Write-Host "Usage: .\run-system.ps1 [command]"
            Write-Host ""
            Write-Host "Commands:"
            Write-Host "  full       - Full system startup (default)"
            Write-Host "  codespaces - Start in GitHub Codespaces mode (no DB sync)"
            Write-Host "  no-db      - Start without database sync"
            Write-Host "  health   - Run health check only"
            Write-Host "  clean    - Clean cache only"
            Write-Host "  help     - Show this help message"
        }
        default {
            Log-Error "Unknown command: $command"
            Write-Host "Use '.\run-system.ps1 help' for usage information"
            exit 1
        }
    }
}

# Run main function
Main @args

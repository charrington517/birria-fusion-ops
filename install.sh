#!/usr/bin/env bash
set -e

echo "=== TruckFlow Ops Installer ==="

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env"
fi

echo "Installing Node dependencies..."
npm run install:all

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Starting PostgreSQL container..."
  docker compose up -d postgres
  echo "Waiting for PostgreSQL..."
  sleep 8
else
  echo "Docker Compose not available. Make sure PostgreSQL is running and DATABASE_URL is correct."
fi

echo "Initializing database..."
npm run db:init
npm run db:seed

echo "Building frontend..."
npm run build

echo "Done."
echo "Start production with: PORT=5000 npm start"

#!/bin/bash

set -euo pipefail

# Load environment variables
if [ -f ".env" ]; then
  source .env
fi

# Validate required environment variables
required_vars=("TWITTER_API_KEY" "TWITTER_API_SECRET" "TWITTER_BEARER_TOKEN" "GEMINI_API_KEY" "GITHUB_PERSONAL_ACCESS_TOKEN" "GITHUB_REPO" "GITHUB_FOLDER" "MONGODB_URI" "CRON_SCHEDULE" "PORT")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: Missing required environment variable: $var" >&2
    exit 1
  fi
done

# Project directories
project_dir=$(cd "$(dirname "$0")" && pwd)
log_file="$project_dir/logs/startup.log"
pid_file="$project_dir/pids/app.pid"

# Database connection
start_database() {
  echo "$(date +"%Y-%m-%d %H:%M:%S") Starting MongoDB..."
  mongod --config "$project_dir/mongod.conf" &> "$log_file" &
  wait_for_service mongodb "$MONGODB_URI" 30 5
}

# Backend server startup
start_backend() {
  echo "$(date +"%Y-%m-%d %H:%M:%S") Starting backend server..."
  cd "$project_dir/src/api" || exit 1
  node app.js &> "$log_file" &
  wait_for_service backend "http://localhost:${PORT}" 30 5
}


# Cron job initiation
start_cron() {
    echo "$(date +"%Y-%m-%d %H:%M:%S") Starting cron job..."
    cd "$project_dir/src/cron" || exit 1
    node cronJob.js &> "$log_file" &
}

# Store process IDs
store_pid() {
  if [ -n "$1" ]; then
      echo "$1" > "$pid_file"
  fi
}

# Cleanup function
cleanup() {
  echo "$(date +"%Y-%m-%d %H:%M:%S") Cleaning up..."
  kill $(cat "$pid_file" 2>/dev/null) 2>/dev/null
  rm -f "$pid_file"
  # Add more cleanup logic as needed (e.g., for other services)
}


# Trap signals
trap cleanup EXIT ERR

# Main execution flow
start_database
backend_pid=$!
store_pid "$backend_pid"
start_cron
echo "$(date +"%Y-%m-%d %H:%M:%S") Startup complete. Backend running on port ${PORT}."
wait "$backend_pid"
exit 0

```
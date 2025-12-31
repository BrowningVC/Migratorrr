#!/bin/bash

# Migratorrr Server Management Script
# Usage: ./scripts/servers.sh [start|stop|restart|status|logs]

cd "$(dirname "$0")/.." || exit 1

case "$1" in
  start)
    echo "Starting servers..."
    mkdir -p logs

    # Start backend
    nohup npm run dev:server > logs/server.log 2>&1 &
    echo "Backend starting (PID: $!)"

    sleep 3

    # Start frontend
    nohup npm run dev:web > logs/web.log 2>&1 &
    echo "Frontend starting (PID: $!)"

    sleep 5
    echo ""
    $0 status
    ;;

  stop)
    echo "Stopping servers..."
    lsof -ti :3000 | xargs kill -9 2>/dev/null && echo "Frontend stopped" || echo "Frontend not running"
    lsof -ti :3001 | xargs kill -9 2>/dev/null && echo "Backend stopped" || echo "Backend not running"
    ;;

  restart)
    $0 stop
    sleep 2
    $0 start
    ;;

  status)
    echo "=== Server Status ==="
    BACKEND=$(lsof -i :3001 2>/dev/null | grep LISTEN)
    FRONTEND=$(lsof -i :3000 2>/dev/null | grep LISTEN)

    if [ -n "$BACKEND" ]; then
      echo "Backend (3001):  RUNNING"
    else
      echo "Backend (3001):  STOPPED"
    fi

    if [ -n "$FRONTEND" ]; then
      echo "Frontend (3000): RUNNING"
    else
      echo "Frontend (3000): STOPPED"
    fi
    ;;

  logs)
    case "$2" in
      server|backend)
        tail -f logs/server.log
        ;;
      web|frontend)
        tail -f logs/web.log
        ;;
      *)
        echo "Showing both logs (Ctrl+C to exit)..."
        tail -f logs/server.log logs/web.log
        ;;
    esac
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|logs [server|web]}"
    exit 1
    ;;
esac

#!/bin/bash
echo "=== UPDATING FROM GITHUB ==="
git fetch origin
git reset --hard origin/main
echo "=== STARTING NOXASTORE WALLET SERVER ==="
node server.js

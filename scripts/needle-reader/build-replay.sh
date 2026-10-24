#!/bin/bash
# Replay preview build. Invoked via box-test-slot so the slot command line
# does not itself contain "npm run build" (that string makes the slot think
# a build is already running and refuse the second slot).
cd "$(dirname "$0")/../.."
export VITE_ENABLE_PRESSURE_LAB=true
export VITE_PRESSURE_REPLAY=true
exec npm run build

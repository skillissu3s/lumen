#!/bin/sh
set -e

# A fresh volume mounts owned by root; give it to the app user before dropping
# privileges so the server can write the workspace and SQLite database.
mkdir -p /data
chown -R node:node /data

exec su-exec node "$@"

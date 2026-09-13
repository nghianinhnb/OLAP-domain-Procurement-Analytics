#!/bin/bash
set -e

echo "=== Initializing ClickHouse Databases ==="
clickhouse-client -n <<-EOSQL
    CREATE DATABASE IF NOT EXISTS bronze;
    CREATE DATABASE IF NOT EXISTS silver;
    CREATE DATABASE IF NOT EXISTS gold;
EOSQL

echo "=== Applying Bronze Migrations ==="
for f in /docker-entrypoint-initdb.d/bronze/*.sql; do
    if [ -f "$f" ]; then
        echo "Applying: $f"
        clickhouse-client --multiquery < "$f"
    fi
done

echo "=== Applying Silver Migrations ==="
for f in /docker-entrypoint-initdb.d/silver/*.sql; do
    if [ -f "$f" ]; then
        echo "Applying: $f"
        clickhouse-client --multiquery < "$f"
    fi
done

echo "=== Applying Gold Migrations ==="
for f in /docker-entrypoint-initdb.d/gold/*.sql; do
    if [ -f "$f" ]; then
        echo "Applying: $f"
        clickhouse-client --multiquery < "$f"
    fi
done

echo "=== ClickHouse Migrations Completed Successfully ==="

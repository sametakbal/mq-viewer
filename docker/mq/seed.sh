#!/usr/bin/env bash
# Puts sample messages into the local QM1 (JSON, XML, FIX with SOH, STX/ETX frames, CRLF text).
# Usage: docker/mq/seed.sh            (container must be running and healthy)
set -euo pipefail
C=mq-viewer-qm1
put() { docker exec -i "$C" /opt/mqm/samp/bin/amqsput "$1" QM1 >/dev/null; }

for i in $(seq 1 25); do
  printf '{"paymentId":"PAY-%05d","amount":%d.%02d,"currency":"EUR","status":"NEW"}\n' "$i" $((RANDOM % 900 + 10)) $((RANDOM % 100))
done | put PAYMENTS.IN

for i in $(seq 1 85); do
  printf '<order><id>%d</id><sku>SKU-%03d</sku><qty>%d</qty></order>\n' "$i" $((RANDOM % 500)) $((RANDOM % 9 + 1))
done | put ORDERS.IN

for i in $(seq 1 5); do
  printf '8=FIX.4.4\x019=112\x0135=D\x0149=CLIENT\x0156=BROKER\x0134=%d\x0111=ORD%d\x0155=AAPL\x0154=1\x0138=100\x0140=2\x0144=187.5\x0110=128\x01\n' "$i" "$i"
done | put FIX.IN

for i in $(seq 1 5); do
  printf '\x01HDR%04d\x02BODY;ACC=TR%08d;AMT=%d\r\x03\x04\n' "$i" $((RANDOM * 100)) $((RANDOM % 1000))
done | put FRAMED.IN

printf 'login user=svc_pay ok\nlogin user=svc_batch denied\n' | put AUDIT.LOG
printf 'hello from DEV.QUEUE.1\n' | put DEV.QUEUE.1

echo "Seeded QM1: PAYMENTS.IN 25, ORDERS.IN 85/100, FIX.IN 5, FRAMED.IN 5, AUDIT.LOG 2, DEV.QUEUE.1 1"

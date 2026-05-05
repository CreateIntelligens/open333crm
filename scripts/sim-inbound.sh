#!/usr/bin/env bash
# Simulate an inbound customer message → triggers KB autoreply / clarify
# Usage: ./sim-inbound.sh "壞了怎辦"
#        ./sim-inbound.sh "請問冰箱保固多久"

set -e

MESSAGE="${1:-壞了怎辦}"
CHANNEL_ID="${CHANNEL_ID:-d0000000-0000-0000-0000-000000000003}"  # WEBCHAT default
CONTACT_UID="${CONTACT_UID:-webchat-user-chen}"
CHANNEL_TYPE="${CHANNEL_TYPE:-WEBCHAT}"
CONTACT_NAME="${CONTACT_NAME:-陳小芳}"

API_BASE="http://localhost:3001/api/v1"

# Login
TOKEN=$(curl -s -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to login"
  exit 1
fi

echo "📨 [→ $CHANNEL_TYPE / $CONTACT_NAME] $MESSAGE"
RESP=$(curl -s -X POST "$API_BASE/simulator/send-message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"channelType\": \"$CHANNEL_TYPE\",
    \"channelId\": \"$CHANNEL_ID\",
    \"contactUid\": \"$CONTACT_UID\",
    \"contactName\": \"$CONTACT_NAME\",
    \"contentType\": \"text\",
    \"content\": {\"text\": \"$MESSAGE\"}
  }")

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"

# Wait for bot reply
echo
echo "⏳ Waiting 8s for KB autoreply / clarify…"
sleep 8

CONV_ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data', {}).get('conversation', {}).get('id', ''))" 2>/dev/null)

if [ -n "$CONV_ID" ]; then
  echo
  echo "💬 Latest BOT message in conversation $CONV_ID:"
  PGPASSWORD=crmpassword docker exec open333crm-postgres psql -U crm -d open333crm -t -c "
    SELECT '  Reply: ' || (content->>'text') || E'\n  Kind:  ' || (metadata->>'replyKind') || E'\n  Sim:   ' || (metadata->>'confidence')
    FROM messages
    WHERE \"conversationId\" = '$CONV_ID' AND \"senderType\" = 'BOT'
    ORDER BY \"createdAt\" DESC LIMIT 1;
  " 2>/dev/null
fi

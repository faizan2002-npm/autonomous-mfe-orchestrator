#!/bin/bash
set -e

echo "🧪 Running Jest with coverage..."
pnpm test:jest:coverage

LINES=$(grep '"lines"' coverage/coverage-summary.json | grep -oP '\d+\.\d+' | head -1)
echo ""
echo "📊 Coverage: ${LINES}% lines"

if (( $(echo "$LINES < 70" | bc -l) )); then
  echo "❌ Below 70% threshold"
  exit 1
fi

echo "✅ Coverage meets threshold"
exit 0

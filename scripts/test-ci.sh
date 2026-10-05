#!/bin/bash
set -e

echo "🏗️  Building..."
pnpm build

echo "📝 Linting..."
pnpm lint

echo "🧪 Unit tests..."
pnpm test

echo "📊 Coverage check..."
bash scripts/test-coverage.sh

echo "🐳 Integration tests (this may take a while)..."
bash scripts/test-integration.sh

echo "✅ All tests passed!"

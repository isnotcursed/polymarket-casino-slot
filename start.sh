#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Bun
if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun not installed${NC}"
    echo -e "${YELLOW}Install: curl -fsSL https://bun.sh/install | bash${NC}"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    bun install || exit 1
fi

# Start server
export NODE_TLS_REJECT_UNAUTHORIZED=0
bun --hot src/index.ts
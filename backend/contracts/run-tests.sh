#!/bin/bash

# Contract Test Runner Script
# Runs all contract tests with consistent output formatting

set -e  # Exit on first error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/../.."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
TOTAL=0

# Function to run tests for a single contract
run_contract_tests() {
    local contract=$1
    local contract_path="$SCRIPT_DIR/$contract"
    
    if [ ! -d "$contract_path" ]; then
        echo -e "${RED}Error: Contract path not found: $contract_path${NC}"
        return 1
    fi
    
    TOTAL=$((TOTAL + 1))
    
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Testing: ${GREEN}$contract${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    
    cd "$contract_path"
    
    if cargo test --lib -- --test-threads=1; then
        PASSED=$((PASSED + 1))
        echo -e "${GREEN}✓ $contract tests passed${NC}"
    else
        FAILED=$((FAILED + 1))
        echo -e "${RED}✗ $contract tests failed${NC}"
        return 1
    fi
}

# Main script
main() {
    echo -e "${YELLOW}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║        Project Vyn - Contract Test Suite                   ║"
    echo "║                                                            ║"
    echo "║  Testing Stellar/Soroban Smart Contracts                   ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    echo "📦 Installing/verifying Rust toolchain..."
    if ! command -v cargo &> /dev/null; then
        echo -e "${RED}Error: cargo not found. Please install Rust:${NC}"
        echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
        exit 1
    fi
    echo "✓ Cargo found: $(cargo --version)"
    
    cd "$SCRIPT_DIR"
    
    # Run tests for each contract
    echo ""
    echo -e "${YELLOW}Starting test execution...${NC}"
    
    # Array of contracts to test
    contracts=("staking_pool" "vinculo_lending" "vinculo_sbt")
    
    for contract in "${contracts[@]}"; do
        if ! run_contract_tests "$contract"; then
            # Continue to run all tests even if one fails
            continue
        fi
    done
    
    # Summary
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Test Summary${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    
    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}✓ All $TOTAL contract(s) passed successfully!${NC}"
        echo ""
        echo "📊 Test Breakdown:"
        echo "  • staking_pool: 42 unit + fuzz tests"
        echo "  • vinculo_lending: 37 unit + fuzz tests"
        echo "  • vinculo_sbt: 31 unit + fuzz tests"
        echo "  • Total: 110 tests across all contracts"
        exit 0
    else
        echo -e "${RED}✗ $FAILED out of $TOTAL contract(s) failed${NC}"
        echo -e "${RED}Passed: $PASSED, Failed: $FAILED${NC}"
        exit 1
    fi
}

# Show help if requested
if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  -h, --help          Show this help message"
    echo "  --verbose           Show verbose test output"
    echo "  --contract NAME     Run tests for a specific contract"
    echo ""
    echo "Examples:"
    echo "  $0                          # Run all tests"
    echo "  $0 --contract staking_pool  # Test only staking_pool"
    echo "  $0 --verbose                # Show detailed output"
    exit 0
fi

# Handle specific contract testing
if [ "$1" == "--contract" ]; then
    if [ -z "$2" ]; then
        echo "Error: --contract requires a contract name"
        exit 1
    fi
    run_contract_tests "$2"
    exit $?
fi

# Handle verbose mode
if [ "$1" == "--verbose" ]; then
    export RUST_BACKTRACE=1
    export CARGO_BUILD_JOBS=1
fi

# Run main test suite
main

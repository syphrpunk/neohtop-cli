# NeoHtop CLI — task runner (run `just --list` to see all recipes)

version := env_var_or_default("VERSION", "dev")

# Default: build the native binary
default: build

# Resolve Go dependencies (run once or after adding new imports)
deps:
    cd cli && go mod tidy

# Build the Go CLI (CGo required on macOS)
build:
    cd cli && CGO_ENABLED=1 go build -ldflags="-s -w -X main.version={{version}}" -o ../neohtop-cli .
    @echo "Binary built: ./neohtop-cli"

# Development build (race detector enabled)
dev:
    cd cli && CGO_ENABLED=1 go build -race -o ../neohtop-cli .

# Run Go tests
test:
    cd cli && CGO_ENABLED=1 go test -count=1 ./...

# Clean build artifacts
clean:
    cd cli && go clean
    rm -f neohtop-cli neohtop-cli.exe neohtop-cli-*

# Install to system
install: build
    cp neohtop-cli /usr/local/bin/

# ---- TypeScript port (ts/ — incur-based agent CLI) ----

# Install TS dependencies
ts-setup:
    cd ts && bun install

# Run the TS CLI (pass args after --, e.g. `just ts top --count 5`)
ts *args:
    cd ts && bun run src/index.ts {{args}}

# Type-check the TS port
ts-check:
    cd ts && bunx tsc --noEmit

# Run TS tests
ts-test:
    cd ts && bun test

# Compile the TS CLI to a standalone binary (ts/dist/neohtop)
ts-compile:
    cd ts && bun build --compile --minify src/index.ts --outfile dist/neohtop

# Note: cross-compiling (--target=bun-<os>-<arch>) fails on bun canary —
# cross-target runtimes aren't downloadable for canary versions. Release
# binaries are compiled natively per-platform in CI (see release.yml).

# Cross-compilation targets
# Note: macOS builds require CGo (for libproc/mach), Linux builds are pure Go
build-linux-amd64:
    cd cli && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ../neohtop-cli-linux-amd64 .

build-linux-arm64:
    cd cli && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o ../neohtop-cli-linux-arm64 .

build-macos-arm64:
    cd cli && GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -o ../neohtop-cli-macos-arm64 .

build-macos-amd64:
    cd cli && GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -o ../neohtop-cli-macos-amd64 .

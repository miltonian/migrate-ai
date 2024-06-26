#!/bin/bash

set -e

VERSION="1.0.2"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)
    ARCH="amd64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  linux)
    URL="https://github.com/miltonian/migrate-ai/releases/download/${VERSION}/migrate-ai-linux-${ARCH}"
    ;;
  darwin)
    URL="https://github.com/miltonian/migrate-ai/releases/download/${VERSION}/migrate-ai-macos-${ARCH}"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

echo "Downloading migrate-ai from ${URL}..."
sudo curl -L -o /usr/local/bin/migrate-ai "${URL}"
sudo chmod +x /usr/local/bin/migrate-ai

echo "migrate-ai installed successfully."

#!/bin/bash

set -e

VERSION="v1.0.0"
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
    URL="https://github.com/miltonian/celp-cli/releases/download/${VERSION}/celp-cli-linux-${ARCH}"
    ;;
  darwin)
    URL="https://github.com/miltonian/celp-cli/releases/download/${VERSION}/celp-cli-macos-${ARCH}"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

echo "Downloading celp-cli from ${URL}..."
sudo curl -L -o /usr/local/bin/celp-cli "${URL}"
sudo chmod +x /usr/local/bin/celp-cli

echo "celp-cli installed successfully."

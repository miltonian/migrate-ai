#!/bin/bash

set -e

VERSION="v1.0.0"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

if [ "$OS" != "linux" ] && [ "$OS" != "darwin" ]; then
  echo "Unsupported OS: $OS"
  exit 1
fi

if [ "$ARCH" != "x86_64" ]; then
  echo "Unsupported architecture: $ARCH"
  exit 1
fi

URL="https://github.com/miltonian/celp-cli/releases/download/${VERSION}/celp-cli-${OS}"

echo "Downloading celp-cli from ${URL}..."
curl -L -o /usr/local/bin/celp-cli "${URL}"
chmod +x /usr/local/bin/celp-cli

echo "celp-cli installed successfully."

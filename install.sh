#!/bin/sh

set -e

OS=$(uname)
ARCH=$(uname -m)
if [ "$OS" = "Linux" ]; then
  if [ "$ARCH" = "x86_64" ]; then
    URL="https://github.com/miltonian/celp-cli/releases/download/v1.0.0/celp-cli-linux"
  else
    echo "Unsupported architecture: $ARCH"
    exit 1
  fi
elif [ "$OS" = "Darwin" ]; then
  URL="https://github.com/miltonian/celp-cli/releases/download/v1.0.0/celp-cli-macos"
else
  echo "Unsupported OS: $OS"
  exit 1
fi

DESTINATION="/usr/local/bin/celp-cli"

echo "Downloading celp-cli from $URL..."
curl -L $URL -o $DESTINATION

echo "Making celp-cli executable..."
chmod +x $DESTINATION

echo "celp-cli installed successfully at $DESTINATION"

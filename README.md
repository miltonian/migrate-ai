# celp-cli

`celp-cli` is a command-line tool designed to help developers generate unit tests for their Node.js projects. It uses AI to assist in creating meaningful and effective tests based on the code and git diffs.

## Installation

To install `celp-cli`, run the following command:

```sh
curl -s https://raw.githubusercontent.com/miltonian/celp-cli/main/install.sh | bash
```

This script will download the latest version of celp-cli and install it to /usr/local/bin.
Usage
Check Version

To check the installed version of celp-cli, run:

```sh
celp-cli --version
```

## Generate Unit Tests

To generate unit tests, navigate to your project directory and run:

```sh
celp-cli writeTests
```

This command will analyze your code and generate unit tests based on the identified changes and existing code structure.

## Commands

    celp-cli --version: Displays the current version of celp-cli.
    celp-cli writeTests: Generates unit tests for your project.

## Documentation

For detailed documentation, visit the Wiki.

## Troubleshooting

Common Issues

    Permission Denied: Ensure you have the necessary permissions to install to /usr/local/bin. You may need to run the install script with sudo.
    Unsupported OS/Architecture: Currently, celp-cli supports Linux x86_64 and macOS. Ensure your system meets these requirements.

## Reporting Issues

If you encounter any issues or have suggestions for improvements, please open an issue.

## Contributing

We welcome contributions! Please see our Contributing Guide for more details.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

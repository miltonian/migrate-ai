# migrate.ai

`migrate.ai` is a CLI tool designed to assist in migrating code from various frameworks and languages, such as Vue 2 to Vue 3 or JavaScript to TypeScript. It uses OpenAI to help perform these migrations and includes features for formatting code and managing configurations.

## Installation

To install `migrate.ai`, use npm:

```sh
npm install -g @miltonian/migrate-ai
```

## Requirements

### ESLint

For best results, it is recommended to use ESLint with appropriate plugins and configurations for the target language and framework. You can install ESLint using:

```sh
npm install --save-dev eslint
```

## Usage

`migrate.ai` provides several commands to help you migrate your code.

### Commands

- **vue2ToVue3**: Migrate Vue 2 code to Vue 3.
- **javascriptToTypescript**: Migrate JavaScript code to TypeScript.
- **migrateWithPrompt**: Run a custom migration based on a provided prompt.

### Running Commands

To migrate Vue 2 code to Vue 3:

```sh
migrate-ai vue2ToVue3
```

To migrate JavaScript code to TypeScript:

```sh
migrate-ai javascriptToTypescript
```

To run a custom migration with a prompt:

```sh
migrate-ai migrateWithPrompt "Your custom prompt here"
```

## Configuration

`migrate.ai` will automatically look for a `.prettierrc` file or other Prettier configuration files in your project root to use for formatting.

### Supported File Extensions

The tool supports various file extensions based on the migration task. For instance, when migrating Vue 2 to Vue 3, it will process `.vue` files.

### File Inclusion/Exclusion

By default, `migrate.ai` will include files with specific extensions and exclude certain directories and file types to focus on the relevant parts of your codebase.

## Environment Setup

Before running any migration, `migrate.ai` sets up the environment by modifying the `.gitignore` file to include the necessary cache directories and clearing old session data.

## How It Works

1. **Setup Environment**: Adds necessary files to `.gitignore` and clears old session data.
2. **Fetch Configuration**: Ensures the OpenAI API key is available and fetches any existing assistant configurations.
3. **Process Files**: Finds the relevant files based on the migration task and processes each file using OpenAI.
4. **Format Code**: Uses Prettier to format the migrated code according to the project's configuration.
5. **Completion Message**: Displays a summary of the changes made to the codebase.

## Example Usage

```sh
migrate-ai vue2ToVue3
migrate-ai javascriptToTypescript
migrate-ai migrateWithPrompt "Migrate this custom code..."
```

## Development

### Commands

- **vue2ToVue3**: Handles the migration from Vue 2 to Vue 3.
- **javascriptToTypescript**: Handles the migration from JavaScript to TypeScript.
- **migrateWithPrompt**: Custom migration based on the provided prompt.

## Contribution

Feel free to open issues or submit pull requests for improvements and bug fixes.

## License

This project is licensed under the MIT License.

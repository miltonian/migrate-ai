# migrate.ai

`migrate.ai` is a command-line tool designed to assist in the migration of JavaScript projects to TypeScript and Vue 2 projects to Vue 3 using OpenAI's powerful language models. This tool helps developers by automating the code migration process, reducing manual effort, and ensuring code consistency.

## Features

- **JavaScript to TypeScript Migration**: Automatically convert your JavaScript files to TypeScript.
- **Vue 2 to Vue 3 Migration**: Automatically convert your Vue 2 components to Vue 3.
- **Customizable Configuration**: Easily configure which files to include or exclude from the migration process.
- **Git Integration**: Automatically handles gitignore modifications and ensures clean migration.
- **OpenAI Integration**: Leverages OpenAI's language models to provide accurate and efficient code transformations.

## Installation

To install `migrate.ai`, use npm:

```sh
npm install -g @celp/migrate-ai
```

## Usage

After installation, you can use the following commands to perform migrations:

### JavaScript to TypeScript Migration

To migrate JavaScript files to TypeScript, run:

```sh
migrate-ai javascriptToTypescript
```

### Vue 2 to Vue 3 Migration

To migrate Vue 2 components to Vue 3, run:

```sh
migrate-ai vue2ToVue3
```

### Prompt A Custom Migration

You can also give it your own prompt to run whatever migration you want, run:

```sh
migrate-ai migrateWithPrompt
```

## Configuration

The tool uses a configuration file located at `.migrate-ai/.cache/.config.json` in your project root to store and retrieve API keys and other settings.

### Ensuring OpenAI API Key

If the OpenAI API key is not present, the tool will prompt you to enter it. The key will be saved in the configuration file for future use.

## How It Works

1. **Setup Environment**: The tool resets token counts and modifies the `.gitignore` file to include `.migrate-ai`.
2. **API Key Validation**: Ensures that an OpenAI API key is present. If not, it prompts the user to enter one.
3. **Assistant Creation**: Creates or retrieves an OpenAI assistant to handle the migration process.
4. **File Processing**: Identifies files to include or exclude from the migration based on user configuration.
5. **Migration**: Processes each file, applies necessary transformations, and fixes any errors.
6. **Completion Message**: Displays a summary of the changes made to the codebase.

## Example

To migrate a Vue 2 project to Vue 3:

```sh
migrate-ai vue2ToVue3
```

To migrate a JavaScript project to TypeScript:

```sh
migrate-ai javascriptToTypescript
```

## Development

### Running Locally

To run the tool locally for development purposes:

1. Clone the repository.
2. Install the dependencies using `npm install`.
3. Run the tool using `node path/to/cli.js [command]`.

### Example:

```sh
node /path/to/cli.js vue2ToVue3
```

## Troubleshooting

### Common Issues

- **Workspace Not Found**: Ensure you are running the tool from the root directory of your project.
- **API Key Errors**: Make sure your OpenAI API key is correctly entered and valid.
- **File Not Found**: Verify that the files to be migrated exist and the correct file extensions are specified in the configuration.

## Contributions

Contributions are welcome! Please submit a pull request or open an issue to discuss any changes or improvements.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

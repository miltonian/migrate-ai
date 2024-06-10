import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";
import { replaceAllCodeInFile } from "./existingFile.utils";
import { migratePrompt } from "./index";
import { sendMessageToAssistant } from "./openai-utils";

export const delay = async (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Adds a directory path to the .gitignore file in the given directory.
 * @param directoryPath The path to the directory to add to .gitignore.
 * @returns A promise that resolves when the operation is complete.
 */
export async function addToGitignore(directoryPath: string): Promise<void> {
  const workspaceRoot = process.cwd(); // Assuming the current working directory is the root of the workspace
  const gitignorePath = path.join(workspaceRoot, ".gitignore");

  try {
    // Try to read the existing .gitignore
    let content = "";
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, "utf-8");
    }

    // Check if the directory is already in the .gitignore
    if (content.includes(directoryPath)) {
      console.info(`${directoryPath} is already in .gitignore.`);
      return;
    }

    // Append the new directory path
    const newContent = content + (content ? "\n" : "") + directoryPath + "\n";

    // Write the updated content back to .gitignore
    fs.writeFileSync(gitignorePath, newContent, "utf-8");
    console.info(`${directoryPath} added to .gitignore.`);
  } catch (error: any) {
    console.error(`Failed to update .gitignore: ${error.message}`);
  }
}

export const minimizeCode = (code: string): string => {
  // Remove comments
  code = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

  // Remove extra whitespace
  code = code.replace(/\s{2,}/g, " ");
  code = code.replace(/\s*([{};=()>,])\s*/g, "$1");

  // Simplify function declaration to arrow function
  code = code.replace(
    /function\s+(\w+)\s*\(([^)]*)\)\s*\{([^}]*)\}/g,
    (match, fName, args, body) =>
      `${fName}=${args.trim()}=>${body.trim().replace(/return\s+/, "")}`
  );

  // Trim leading and trailing spaces
  code = code.trim();

  return code;
};

export const fixErrorsInCodeAndOverwriteFile = async (
  filePath: string,
  code: string,
  isPartialCode?: boolean,
  errors?: string[]
) => {
  let codeToAdd = code;
  let i = 0;
  let reflectionIterationMax = 2;
  let errorsParam: string[] | undefined | null = errors;

  while (i < reflectionIterationMax) {
    const errorsInFile =
      errorsParam || [
        ...(await checkESLintErrors(filePath).catch((err) => {
          console.warn(err);
          return [];
        })),
        ...getAllTypeErrors(filePath),
      ] ||
      [];

    console.log(`fixing the following errors in file: `, { errorsInFile });
    errorsParam = null;

    if (!errorsInFile.length) {
      i++;
      break;
    }
    const fixedCodeStr = await sendMessageToAssistant(
      `The code you added

      ${isPartialCode ? codeToAdd : ""}

        resulted in these errors. please fix it and return ALL of the fixed code. Your response should only contain code in the json format {"code": string}. but please remember the context from this conversation when you think about your answer.

        ${errorsInFile.join("\n")}

        Your response should only contain code in the json format {"code": string}
        `,
      "gpt-4o",
      `Your response should only contain code in the json format {"code": string}`
    );
    let fixedCodeJSON: { code: string } | null = null;
    try {
      fixedCodeJSON = JSON.parse(
        fixedCodeStr?.message?.replace(/```json/g, "").replace(/```/g, "") || ""
      );
    } catch (error) {
      console.error(error);
    }
    if (fixedCodeJSON?.code) {
      const fixedCode = fixedCodeJSON?.code || "";
      replaceAllCodeInFile(filePath, fixedCode);
      // codeToAdd = await formatFileContent(filePath);

      // replaceAllCodeInFile(filePath, codeToAdd);
    }

    i++;
  }

  return codeToAdd;
};

/**
 * Reads a file and minimizes the content for processing.
 * @param filePath Path to the file to be read and minimized.
 */
export async function unminimizeCodeFromFile(
  filePath: string
): Promise<string> {
  const fileContents = fs.readFileSync(filePath, "utf8");
  return fileContents;
}

export async function generateInsertionCode(code: string): Promise<string> {
  console.log("starting generateInsertionCode");
  const prompt = `you are a distinguished software engineer that excels in migrating legacy code to modern code with the best practices. ${migratePrompt}. your response should only contain json format {"code": string}. your response has to be only json. here is the code in the file i want you to migrate: ${minimizeCode(code)}`;

  let codeToAddJSONStr = await sendMessageToAssistant(
    prompt,
    "gpt-4o",
    `you are a distinguished software engineer that excels in migrating legacy code to modern code with the best practices. your response should only contain json format {"code": string}. your response has to be only json.`
  );
  let codeToAddJSON: { code: string } | null = null;
  try {
    codeToAddJSON = JSON.parse(
      codeToAddJSONStr?.message?.replace(/```json/g, "").replace(/```/g, "") ||
        ""
    );
  } catch (error) {
    console.error(error);
    console.log("trying again...");
  }
  return codeToAddJSON?.code || "";
}

/**
 * Function that formats code using Prettier.
 * @param filePath The path of the file.
 * @returns The formatted content to be written to the file.
 */
export async function formatFileContent(filePath: string): Promise<string> {
  const fileContent = await fs.promises.readFile(filePath, "utf-8");
  try {
    const prettierOptions = await prettier.resolveConfig(filePath);

    if (!prettierOptions) {
      // throw new Error("Prettier configuration not found.");
      console.warn(
        `Prettier configuration not found. Using default prettier format`
      );

      return prettier.format(fileContent, {
        parser: inferParser(fileContent) || undefined,
        tabWidth: 2,
        useTabs: false,
        semi: true,
        singleQuote: true,
      });
    }

    return prettier.format(fileContent, prettierOptions);
  } catch (error) {
    console.error(error);
    return fileContent;
  }
}

/**
 * Determines the appropriate parser for a given file extension.
 *
 * @param {string} filePath - The path of the file.
 * @returns {string | null} The parser to use for formatting, or null if unsupported.
 */
const inferParser = (filePath: string): string | null => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
      return "typescript";
    case ".js":
      return "babel";
    case ".json":
      return "json";
    case ".css":
      return "css";
    case ".scss":
      return "scss";
    case ".html":
      return "html";
    case ".md":
      return "markdown";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".xml":
      return "xml";
    case ".graphql":
    case ".gql":
      return "graphql";
    case ".sql":
      return "sql";
    case ".vue":
      return "vue";
    case ".py":
      return "python";
    default:
      return null; // Unsupported file extension
  }
};

import * as ts from "typescript";

/**
 * Helper function to get all type errors from TypeScript diagnostics.
 * @param filePath The path of the TypeScript file.
 * @returns An array of diagnostic messages.
 */
export const getAllTypeErrors = (filePath: string): string[] => {
  try {
    const configPath = ts.findConfigFile(
      filePath,
      ts.sys.fileExists,
      "tsconfig.json"
    );
    if (!configPath) {
      throw new Error("Could not find tsconfig.json");
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsedCommandLine = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );

    const program = ts.createProgram({
      rootNames: [filePath],
      options: parsedCommandLine.options,
      projectReferences: parsedCommandLine.projectReferences,
    });

    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return [];

    const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile);

    const errorMessages: string[] = diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );
      const { line, character } =
        diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
      return `Error ${diagnostic.code} at ${filePath} (${line + 1},${character + 1}): ${message}`;
    });

    return errorMessages;
  } catch (error) {
    console.warn(error);
    return [];
  }
};

import { exec } from "child_process";

export const checkESLintErrors = async (
  absoluteFilePath: string
): Promise<string[]> => {
  // const targetProjectRoot = findTargetProjectRoot(absoluteFilePath);
  const targetProjectRoot = process.cwd();

  const relativeFilePath = path.relative(targetProjectRoot, absoluteFilePath);
  const eslintConfigPath = path.resolve(targetProjectRoot, ".eslintrc.json");
  const eslintBinaryPath = path.resolve(
    targetProjectRoot,
    "node_modules",
    ".bin",
    "eslint"
  );

  return new Promise((resolve, reject) => {
    exec(
      `${eslintBinaryPath} --config ${eslintConfigPath} --ignore-pattern '!node_modules/*' ${relativeFilePath} -f json`,
      (error, stdout, stderr) => {
        if (error && error.code !== 1) {
          // If there is an error and it's not just linting errors (which have code 1), reject the promise
          reject(`Failed to run ESLint: ${stderr}`);
        } else {
          try {
            const results = JSON.parse(stdout);
            const errorMessages: string[] = [];

            results.forEach((result: any) => {
              result.messages.forEach((message: any) => {
                const errorMessage = `Error in ${result.filePath} [${message.line}:${message.column}]: ${message.message} (${message.ruleId})`;
                errorMessages.push(errorMessage);
              });
            });

            resolve(errorMessages);
          } catch (parseError: any) {
            reject(`Failed to parse ESLint output: ${parseError.message}`);
          }
        }
      }
    );
  });
};

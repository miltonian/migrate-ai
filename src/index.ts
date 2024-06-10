#! /usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import { v4 } from "uuid";

import * as path from "path";
import { replaceAllCodeInFile } from "./existingFile.utils";
import {
  createAndStoreAssistant,
  deleteThreadIdFile,
  getAssistantIdFromPrompt,
  initializeClient,
  sendMessageToAssistant,
} from "./openai-utils";
import {
  addToGitignore,
  fixErrorsInCodeAndOverwriteFile,
  generateInsertionCode,
  minimizeCode,
  unminimizeCodeFromFile,
} from "./utils";

import chalk = require("chalk");
import ora = require("ora");

const Inquirer = import("inquirer");
const stripJsonComments = import("strip-json-comments");

export let migratePrompt = ``;

export let selectedCode: string = "";
export let selectedCodeWithoutReferences: string = "";
export let currentGitDiff: string = "";
export let fromHighlightedCode = false;

export let mainBranch: "main" | "master" = "main";

interface GithubRepoPreConfig {
  prNumber: number;
  repo: string;
  owner: string;
  githubToken: string;
  branch: string;
  openAiKey: string;
}
let preConfig: GithubRepoPreConfig | null = null;

/**
 * Activates the VS Code extension. This function is called when the extension is activated.
 * @param context - The context provided by VS Code, used for managing lifecycle and state.
 */
export function activate() {
  const program = new Command();

  // Retrieve version from package.json
  const packageJsonPath = path.resolve(__dirname, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const version = packageJson.version;

  // Add version option
  program.version(version, "-v, --version", "Output the current version");

  program
    .command("vue2ToVue3")
    .description("Migrate Vue 2 to Vue 3")
    .action(async () => {
      migrateWithPrompt(`here is a vue 2 file. please migrate this to vue 3`);
    });

  program
    .command("javascriptToTypescript")
    .description("Migrate Javscript to Typescript")
    .action(async () => {
      migrateWithPrompt(
        `here is a javascript file. please migrate this to typescript`
      );
    });

  program
    .command("migrateWithPrompt <prompt>")
    .description("Migrate code using a custom prompt")
    .action(async (prompt: string) => {
      migrateWithPrompt(prompt);
    });

  program.parse(process.argv);
}

/**
 * Sets up the environment by modifying the .gitignore file and clearing old session data.
 * @param context - The extension context.
 */
async function setupEnvironment() {
  await addToGitignore(".migrate-ai");
  await deleteThreadIdFile();
}

export const CONFIG_PATH = path.join(
  process.cwd(),
  ".migrate-ai",
  ".cache",
  ".config.json"
);

function getConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  }
  return {};
}

function setConfig(key: string, value: string) {
  const config = getConfig();
  config[key] = value;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Ensures that an OpenAI API key is present, prompting the user if not.
 * @returns The API key if available, or undefined if not.
 */
async function ensureApiKey(): Promise<string | undefined> {
  if (preConfig?.openAiKey) {
    return preConfig.openAiKey;
  }

  const config = getConfig();
  let openaiApiKey = config.openaiApiKey;

  if (!openaiApiKey) {
    const response = await (
      await Inquirer
    ).prompt([
      {
        type: "input",
        name: "openaiApiKey",
        message: "Enter your OpenAI API Key",
      },
    ]);

    openaiApiKey = response.openaiApiKey;

    if (!openaiApiKey) {
      console.log("Open AI API Key is required!");
      return undefined;
    }

    setConfig("openaiApiKey", openaiApiKey);
  }

  return openaiApiKey;
}

async function migrateWithPrompt(_migratePrompt: string) {
  migratePrompt = _migratePrompt;

  let spinner: ora.Ora | null = null;

  const workspaceFolder = process.cwd();

  if (!workspaceFolder) {
    // console.error("Workspace not found.");
    console.error("Workspace not found.");
    return;
  }

  const celpCacheDir = path.join(workspaceFolder, ".migrate-ai/.cache");
  const threadIdFile = path.join(celpCacheDir, "thread_id");

  // Ensure the .migrate-ai/.cache directory exists
  if (!fs.existsSync(celpCacheDir)) {
    fs.mkdirSync(celpCacheDir, { recursive: true });
  }

  // Create the thread_id file if it doesn't exist
  if (!fs.existsSync(threadIdFile)) {
    fs.writeFileSync(threadIdFile, "");
  }

  const startTime = Date.now();

  // Fetch initial code coverage
  try {
    await setupEnvironment();
    const openaiApiKey = await ensureApiKey();
    if (!openaiApiKey) {
      console.error("no open ai api key found");
      return;
    }
    await initializeClient(openaiApiKey);

    const existingAssistantForThisCode =
      await getAssistantIdFromPrompt(migratePrompt);
    console.log({ existingAssistantForThisCode });

    if (!existingAssistantForThisCode) {
      await createAndStoreAssistant(`migrate-ai-${v4()}`, migratePrompt);
    }

    spinner = ora("Migrating...").start();

    const projectRoot = process.cwd();
    await processFiles(projectRoot);

    spinner.succeed("Code migrated successfully!");
  } catch (err: any) {
    console.error("Failed to process and display snippets:", err);

    console.error("Error processing snippets: " + err.message);
    spinner?.fail("Failed to migrate.");
    console.error(chalk.red(`Error: ${err.message}`));
  }
}

let includeExcludeJson: {
  fileExtensionsToInclude: string[];
  substringsPathsOrExtensionsToExclude: string[];
} | null = null;

/**
 * Recursively find all target files in a directory.
 * @param dir The directory to search.
 * @param filelist The list of files found.
 * @returns An array of file paths.
 */
const findTargetFiles = (dir: string, filelist: string[] = []): string[] => {
  if (
    !includeExcludeJson ||
    !includeExcludeJson?.fileExtensionsToInclude ||
    !includeExcludeJson?.substringsPathsOrExtensionsToExclude
  ) {
    throw new Error("Could not find any files to include or exclude");
  }

  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findTargetFiles(filePath, filelist);
    } else if (
      includeExcludeJson.fileExtensionsToInclude.some((f) =>
        filePath.endsWith(f)
      ) &&
      includeExcludeJson.substringsPathsOrExtensionsToExclude.every(
        (f) => !filePath.includes(f)
      )
    ) {
      filelist.push(filePath);
    }
  }
  return filelist.filter(
    (f) =>
      !f.includes("node_modules") &&
      !f.includes("dist") &&
      !f.includes("out") &&
      !f.includes("build")
  );
};

/**
 * Main function to process all files in the project.
 * @param projectRoot The root directory of the project.
 */
async function processFiles(projectRoot: string): Promise<void> {
  if (!includeExcludeJson) {
    let includeExcludeRaw = await sendMessageToAssistant(`
    for this prompt: ${migratePrompt}
    
    please tell me which file extentions to include when i filter for files. also tell me which directories, file extensions, or substrings i should exclude for the same prompt. return your answer in this json form {"fileExtensionsToInclude": string[]; "substringsPathsOrExtensionsToExclude": string[];}. each list should be exhaustive BUT it is important that these lists will be used to only include the relevant files so please be as narrow and specific as you can. for example, if we're migrating vue we probably don't care about html files. json should be the only thing in your response
    `);

    try {
      includeExcludeJson = JSON.parse(
        (await stripJsonComments)(includeExcludeRaw?.message || "")
          .replace("```json", "")
          .replace("```", "") || ""
      );
    } catch (error) {
      console.error(error);
      console.log("trying again...");
      try {
        includeExcludeRaw = await sendMessageToAssistant(`
          for this prompt: ${migratePrompt}
          
          please tell me which file extentions to include when i filter for files. also tell me which directories, file extensions, or substrings i should exclude for the same prompt. return your answer in this json form {"fileExtensionsToInclude": string[]; "substringsPathsOrExtensionsToExclude": string[];}. json should be the only thing in your response
          `);

        includeExcludeJson = JSON.parse(
          (await stripJsonComments)(includeExcludeRaw?.message || "")
            .replace("```json", "")
            .replace("```", "") || ""
        );
      } catch (error: any) {
        console.error(error);
        throw new Error(error);
      }
    }
  }

  const targetFiles = findTargetFiles(projectRoot);

  const MAX_FILES_TO_PROCESS = 500;
  let i = 0;
  for (const filePath of targetFiles) {
    if (i === MAX_FILES_TO_PROCESS) break;
    console.log(`migrating ${filePath}`);
    let typeerrors: string[] = [];
    const fileCode = minimizeCode(await unminimizeCodeFromFile(filePath));
    const code = await generateInsertionCode(fileCode);
    replaceAllCodeInFile(filePath, code);
    // const formatted = await formatFileContent(filePath);
    // replaceAllCodeInFile(filePath, formatted);
    await fixErrorsInCodeAndOverwriteFile(filePath, code);

    console.log({ typeerrors });
    i++;
  }

  await printCompletionMessage();
}

async function printCompletionMessage() {
  const msg = await sendMessageToAssistant(
    `based on all of the code you changed, please give me a formatted response i can put in the terminal that will look really pretty and give useful information to the user about what was changed in their code base. your response should be complete with nothing to replace, meaning all of the info that needs to be added is already added. your message should be a summary so don't include any code, just summaries of what you did to the code so the user can get a useful high level overview. your response should be only the text that i will insert into a console.log. again your response should only be the text i can put in the console.log. your response should be text. NOT JSON. ONLY TEXT IN YOUR RESPONSE`,
    "gpt-4o",
    "your response should be only the text that i will insert into a console.log. again your response should only be the text i can put in the console.log. your response should be text. NOT JSON. ONLY TEXT IN YOUR RESPONSE"
  );
  console.log(msg?.message.replace(/```/g, ""));
}

activate();

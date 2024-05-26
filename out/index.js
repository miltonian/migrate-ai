"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findEnclosingNodes = exports.CONFIG_PATH = exports.activate = exports.progressBar = exports.fromHighlightedCode = exports.currentGitDiff = exports.selectedCodeWithoutReferences = exports.selectedCode = void 0;
const typescript_estree_1 = require("@typescript-eslint/typescript-estree");
const cli_progress_1 = __importDefault(require("cli-progress"));
const commander_1 = require("commander");
const fs_1 = __importDefault(require("fs"));
const glob_promise_1 = __importDefault(require("glob-promise"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const openai_utils_1 = require("./openai-utils");
const utils_1 = require("./utils");
const Inquirer = import("inquirer");
// import inquirer from 'inquirer';
// Declare a variable for the LanguageClient instance
// let client: LanguageClient;
exports.selectedCode = "";
exports.selectedCodeWithoutReferences = "";
exports.currentGitDiff = "";
exports.fromHighlightedCode = false;
let preConfig = null;
/**
 * Activates the VS Code extension. This function is called when the extension is activated.
 * @param context - The context provided by VS Code, used for managing lifecycle and state.
 */
function activate() {
    // Register a command that will be called when the extension's command is invoked
    //   let disposable = vscode.commands.registerCommand(
    //     "extension.writeTests",
    //     () => {
    //       preConfig = null;
    //       handleCommand(context);
    //     }
    //   );
    //   const program = new Command();
    //   program
    //     .command("writeTests")
    //     .description("Generate tests from selection")
    //     .action(() => {
    //       preConfig = null;
    //       handleCommand();
    //     });
    //   program.parse(process.argv);
    //   let disposable2 = vscode.commands.registerCommand(
    //     "extension.generateUnitTestsFromDiff",
    //     (args: Partial<GithubRepoPreConfig>) => {
    //       preConfig = null;
    //       // handleCommand(context)
    //       if (
    //         args &&
    //         args.openAiKey &&
    //         args.prNumber &&
    //         args.repo &&
    //         args.owner &&
    //         args.githubToken &&
    //         args.branch
    //       ) {
    //         preConfig = args as GithubRepoPreConfig;
    //         highlightAndOpenChangedFiles(context, preConfig);
    //       } else {
    //         highlightAndOpenChangedFiles(context);
    //       }
    //     }
    //   );
    const program = new commander_1.Command();
    program
        .command("writeTests")
        .description("Generate tests from selection")
        .action(() => {
        highlightAndOpenChangedFiles();
    });
    program.parse(process.argv);
}
exports.activate = activate;
/**
 * Sets up the environment by modifying the .gitignore file and clearing old session data.
 * @param context - The extension context.
 */
async function setupEnvironment() {
    await (0, utils_1.addToGitignore)(".celp-ai");
    await (0, openai_utils_1.deleteThreadIdFile)();
    // await deleteAssistantIdFile();
}
const addSelectedCodeWithRefToAIContext = async (filePath, selectedCode) => {
    const identifiableTokens = [selectedCode.slice(0, utils_1.TOKEN_MAX_LENGTH)];
    const codeWithReferences = await (0, utils_1.extractCodeAndReferences)([filePath], identifiableTokens, 3);
    const workspaceRoot = process.cwd();
    if (!workspaceRoot) {
        return;
    }
    await (0, openai_utils_1.sendMessageToAssistant)(`use this for context. await my further instructions ${codeWithReferences}`);
};
exports.CONFIG_PATH = path_1.default.join(process.cwd(), ".celp-ai", ".cache", ".config.json");
function getConfig() {
    if (fs_1.default.existsSync(exports.CONFIG_PATH)) {
        return JSON.parse(fs_1.default.readFileSync(exports.CONFIG_PATH, "utf-8"));
    }
    return {};
}
function setConfig(key, value) {
    const config = getConfig();
    config[key] = value;
    fs_1.default.writeFileSync(exports.CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
/**
 * Ensures that an OpenAI API key is present, prompting the user if not.
 * @returns The API key if available, or undefined if not.
 */
async function ensureApiKey() {
    if (preConfig?.openAiKey) {
        return preConfig.openAiKey;
    }
    const config = getConfig();
    let openaiApiKey = config.openaiApiKey;
    if (!openaiApiKey) {
        const inquirer = await import("inquirer");
        const response = await inquirer.default.prompt([
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
/**
 * Retrieves the GitHub token from the VSCode settings, or prompts the user to enter it if not already stored.
 *
 * @returns {Promise<string>} The GitHub token.
 */
async function ensureGithubToken() {
    if (preConfig?.githubToken) {
        return preConfig.githubToken;
    }
    const config = getConfig();
    let githubToken = config.githubToken;
    if (!githubToken) {
        const inquirer = (await Inquirer).default;
        const response = await inquirer.prompt([
            {
                type: "input",
                name: "githubToken",
                message: "Enter your Github Token",
            },
        ]);
        githubToken = response.githubToken;
        if (!githubToken) {
            console.log("githubToken is required!");
            return undefined;
        }
        setConfig("githubToken", githubToken);
    }
    return githubToken;
}
// export const ensureGithubToken = async (): Promise<string> => {
//   if (preConfig?.githubToken) {
//     return preConfig.githubToken;
//   }
//   const configuration = vscode.workspace.getConfiguration("celp");
//   let token = configuration.get<string>("githubToken");
//   if (!token) {
//     // Prompt user for GitHub token
//     token = await vscode.window.showInputBox({
//       prompt: "Enter your GitHub Token",
//       placeHolder: "Token",
//       ignoreFocusOut: true,
//       password: true, // This makes the input more secure
//     });
//     if (token) {
//       // Save the token to settings
//       await configuration.update(
//         "githubToken",
//         token,
//         vscode.ConfigurationTarget.Workspace
//       );
//       console.info("GitHub token saved.");
//     } else {
//       console.error("GitHub token is required.");
//       throw new Error("GitHub token is required.");
//     }
//   }
//   return token;
// };
/**
 * Retrieves the repo from the preconfig, or prompts the user to enter it if not already stored.
 *
 * @returns {Promise<string>} The Repo.
 */
async function ensureRepo() {
    if (preConfig?.repo) {
        return preConfig.repo;
    }
    const config = getConfig();
    let repo = config.repo;
    if (!repo) {
        const inquirer = (await Inquirer).default;
        const response = await inquirer.prompt([
            {
                type: "input",
                name: "repo",
                message: "Enter your Repo owner and name like {owner}/{repo} (e.g. organization-name/repo-name)",
            },
        ]);
        repo = response.repo;
        if (!repo) {
            console.log("repo is required!");
            return undefined;
        }
        setConfig("repo", repo);
    }
    return repo;
}
// export const ensureRepo = async (): Promise<string> => {
//   if (preConfig?.repo) {
//     return preConfig.repo;
//   }
//   const configuration = vscode.workspace.getConfiguration("celp");
//   let repo = configuration.get<string>("repo");
//   if (!repo) {
//     // Prompt user for GitHub repo
//     repo = await vscode.window.showInputBox({
//       prompt:
//         "Enter your Repo owner and name like {owner}/{repo} (e.g. organization-name/repo-name)",
//       placeHolder: "Github repo {owner}/{repo}",
//       ignoreFocusOut: true,
//     });
//     if (repo) {
//       // Save the repo to settings
//       await configuration.update(
//         "repo",
//         repo,
//         vscode.ConfigurationTarget.Workspace
//       );
//       console.info("Repo saved.");
//     } else {
//       console.error("Repo is required.");
//       throw new Error("Repo is required.");
//     }
//   }
//   return repo;
// };
// export const promptForPRNumber = async (): Promise<number> => {
//   // Prompt user for GitHub PR number
//   const prNumber = await vscode.window.showInputBox({
//     prompt: "Enter the PR Number you'd like to review",
//     placeHolder: "e.g. 123",
//     ignoreFocusOut: true,
//     validateInput: (value) => {
//       // Check if the input is a valid number
//       return isNaN(Number(value)) ? "Please enter a valid number" : null;
//     },
//   });
//   if (!prNumber) {
//     console.error("PR Number is required.");
//     throw new Error("PR Number is required.");
//   }
//   return Number(prNumber);
// };
// export const promptForOpenAIAPIKey = async (): Promise<string> => {
//   const token = await vscode.window.showInputBox({
//     prompt: "Enter your OpenAI API Key",
//     placeHolder: "OpenAI API Key",
//     ignoreFocusOut: true,
//     password: true,
//   });
//   if (!token) {
//     console.error("OpenAI API Key is required.");
//     throw new Error("OpenAI API Key is required.");
//   }
//   return token;
// };
// export const promptForGitHubToken = async (): Promise<string> => {
//   const token = await vscode.window.showInputBox({
//     prompt: "Enter your GH Token",
//     placeHolder: "Github Token",
//     ignoreFocusOut: true,
//     password: true,
//   });
//   if (!token) {
//     console.error("GH Token is required.");
//     throw new Error("GH Token is required.");
//   }
//   return token;
// };
// export const promptForRepo = async (): Promise<string> => {
//   const repo = await vscode.window.showInputBox({
//     prompt: "Enter your Github Repo like this: owner/repo",
//     placeHolder: "{owner}/{repo}",
//     ignoreFocusOut: true,
//   });
//   if (!repo) {
//     console.error("Repo is required.");
//     throw new Error("Repo is required.");
//   }
//   return repo;
// };
/**
 * Prompts the user to select an action for handling test files.
 * @returns A string representing the user's choice or undefined if no choice is made.
 */
// async function promptFileAction(): Promise<string | undefined> {
//   return vscode.window.showQuickPick(
//     [
//       "Create new test file (will prompt you to select an existing test file to use for context)",
//       "Select existing test file",
//     ],
//     {
//       placeHolder:
//         "Do you want to create a new test file or select an existing one?",
//     }
//   );
// }
/**
 * Handles the workflow when an existing test file is selected.
 * @param editor - The active text editor.
 * @param context - The extension context.
 */
async function handleExistingTestFile(autoFilePath) {
    await (0, utils_1.writeTestsInExistingFile)(autoFilePath);
}
/**
 * Handles the workflow when creating a new test file based on context from another file.
 * @param editor - The active text editor.
 * @param context - The extension context.
 */
async function handleNewTestFile(filePath, autoContextTestFile) {
    const newTestFileName = await generateTestFileName(filePath);
    if (!newTestFileName) {
        throw new Error("Could not generate new test file name");
    }
    console.log({ newTestFileName });
    await (0, utils_1.writeTestsToNewFile)(filePath, autoContextTestFile, newTestFileName);
}
function findEnclosingNode(node, position) {
    // Base case: if the position is outside the range of the node, return null
    if (!node.range || position < node.range[0] || position > node.range[1]) {
        return null;
    }
    // Recursive case: traverse child nodes based on node type
    let result = null;
    const checkChildren = (children) => {
        for (const child of children) {
            const childResult = findEnclosingNode(child, position);
            if (childResult) {
                result = childResult;
                break;
            }
        }
    };
    switch (node.type) {
        case "Program":
        case "BlockStatement":
            checkChildren(node.body);
            break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
            if (node.body.type === "BlockStatement") {
                checkChildren(node.body.body);
            }
            break;
        case "IfStatement":
            if (node.consequent) {
                checkChildren([node.consequent]);
            }
            if (node.alternate) {
                checkChildren([node.alternate]);
            }
            break;
        // Add other cases as needed based on the types of nodes you expect to handle
    }
    // Return the smallest node that includes the position
    return result || node;
}
async function highlightAndOpenChangedFiles(
//   context: vscode.ExtensionContext,
args, promptEverything) {
    //   const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const workspaceFolder = process.cwd();
    if (!workspaceFolder) {
        // console.error("Workspace not found.");
        console.error("Workspace not found.");
        return;
    }
    exports.progressBar = new cli_progress_1.default.SingleBar({
        // format: 'CLI Progress |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} Chunks || Speed: {speed}',
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
    });
    //   progressBar.start(100, 0);
    try {
        // progressBar.update(5);
        await setupEnvironment();
        // Update the global state with the currently used AI model
        //   const aiModel = "GPT-4";
        //   context.globalState.update("aiModel", aiModel);
        // Ensure a valid API key is available
        const openaiApiKey = await ensureApiKey();
        exports.progressBar.start(100, 0);
        exports.progressBar.update(5);
        // args?.openAiKey //|| promptEverything
        //   ? await promptForOpenAIAPIKey()
        //   :
        //   await ensureApiKey();
        if (!openaiApiKey) {
            console.error("no open ai api key found");
            return;
        }
        // const githubToken = await ensureGithubToken();
        // progressBar.update(8);
        // args?.githubToken //|| promptEverything
        //   ? await promptForGitHubToken()
        //   :
        // await ensureGithubToken();
        // if (!githubToken) return;
        // const repo = await ensureRepo();
        // progressBar.update(9);
        // args?.repo && //|| promptEverything
        //   ? await promptForRepo()
        //   :
        // if (!repo) return;
        // Initialize the OpenAI client with the API key
        await (0, openai_utils_1.initializeClient)(openaiApiKey);
        exports.progressBar.update(10);
        const changedFiles = (await getChangedFiles(workspaceFolder)).filter((f) => f.endsWith(".ts") && !f.includes(".test.") && !f.includes(".spec."));
        let allSnippets = [];
        let i = 0;
        for (const file of changedFiles) {
            exports.progressBar.update(15);
            const snippets = await collectAndDisplaySnippets(file, workspaceFolder);
            exports.selectedCode = snippets?.codeWithReferences.join("") || "";
            exports.selectedCodeWithoutReferences =
                snippets?.codeWithoutReferences.join("") || "";
            exports.currentGitDiff = snippets?.gitDiff || "";
            console.log({
                snippets,
                currentGitDiff: exports.currentGitDiff,
                selectedCodeWithoutReferences: exports.selectedCodeWithoutReferences,
                selectedCodeWithoutReferencesstring: JSON.stringify(exports.selectedCodeWithoutReferences),
            });
            if (!exports.selectedCode) {
                //   console.info(
                //     `Code has not changed in ${file}, skipping...`
                //   );
                console.info(`Code has not changed in ${file}, skipping...`);
                continue;
            }
            exports.progressBar.update(20);
            const existingAssistantForThisCode = await (0, openai_utils_1.getAssistantIdFromSelectedCode)(exports.selectedCodeWithoutReferences);
            let isExistingAssistant = false;
            if (!existingAssistantForThisCode) {
                await (0, openai_utils_1.createAndStoreAssistant)(`celp-${(0, uuid_1.v4)()}`, exports.selectedCodeWithoutReferences);
            }
            else {
                isExistingAssistant = true;
            }
            // const workspaceRoot =
            //   vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            const workspaceRoot = process.cwd();
            const fullPath = path_1.default.join(workspaceRoot || "", file);
            if (!isExistingAssistant) {
                exports.progressBar.update(25);
                // ADD TO CONTEXT: selected code with references
                await addSelectedCodeWithRefToAIContext(fullPath, exports.selectedCode);
                // ADD TO CONTEXT: selected code with references
                // await addCodeThatReferencesHighlightedToAIContext(context, fullPath, snippets.join(''));
            }
            exports.progressBar.update(25);
            const foundTestFile = await findTestFilePath(file);
            if (foundTestFile) {
                exports.progressBar.update(30);
                // await openFilesInEditor([foundTestFile]);
                await handleExistingTestFile(foundTestFile);
            }
            else {
                exports.progressBar.update(30);
                const foundTestFile = await findFirstTestFile(fullPath);
                if (!foundTestFile) {
                    throw new Error("Could not find test file");
                }
                await handleNewTestFile(fullPath, foundTestFile);
            }
            allSnippets = allSnippets.concat(`${foundTestFile
                ? `will put tests in ${foundTestFile}`
                : `will create new test file`} | ${snippets}`);
            i++;
        }
        // const separator = "____________________________";
        // const snippetsText = allSnippets.join(`\n${separator}\n`);
        // const newDocument = await vscode.workspace.openTextDocument({
        //   content: snippetsText,
        //   language: "text",
        // });
        // await vscode.window.showTextDocument(newDocument, { preview: false });
        exports.progressBar.stop();
    }
    catch (err) {
        console.error("Failed to process and display snippets:", err);
        //   console.error(
        //     "Error processing snippets: " + err.message
        //   );
        console.error("Error processing snippets: " + err.message);
    }
}
//   );
// }
// /**
//  * Finds the first test file in the project that matches the given test patterns within the specified directories relative to the source file's directory.
//  *
//  * @param sourceFilePath The full path to the source file for which tests are being sought.
//  * @returns A Promise that resolves to the path of the first matching test file, or null if no match is found.
//  */
// async function findFirstTestFile(
//   sourceFilePath: string
// ): Promise<string | null> {
//   // Get configuration settings
//   const config = vscode.workspace.getConfiguration("celp");
//   const testPatterns = config.get<string[]>("testPatterns") || [];
//   const testDirs = config.get<string[]>("testDirectoryNames") || [];
//   const sourceFileDir = path.dirname(sourceFilePath);
//   // Iterate over each test directory configured
//   for (const testDir of testDirs) {
//     const testDirPath = path.join(sourceFileDir, testDir); // Compute potential test directory path
//     for (const pattern of testPatterns) {
//       // Construct the full search pattern for the files
//       const searchPattern = new vscode.RelativePattern(
//         testDirPath,
//         `${pattern}`
//       );
//       try {
//         // Search for files matching the pattern in the computed directory
//         const files = await vscode.workspace.findFiles(searchPattern, null, 1); // Limit to 1 to find the first match quickly
//         if (files.length > 0) {
//           return files[0].fsPath; // Return the path of the first matching file found
//         }
//       } catch (error) {
//         // Log errors related to file searching
//         console.error(
//           `Error searching files in directory ${testDirPath} with pattern ${pattern}: ${error}`
//         );
//       }
//     }
//   }
//   // Return null if no matching test files are found after all attempts
//   return null;
// }
/**
 * Finds the first test file in the project that matches the given test patterns within the specified directories relative to the source file's directory.
 *
 * @param sourceFilePath The full path to the source file for which tests are being sought.
 * @param testPatterns An array of test file patterns to match.
 * @param testDirs An array of directory names that typically contain test files.
 * @returns A Promise that resolves to the path of the first matching test file, or null if no match is found.
 */
async function findFirstTestFile(sourceFilePath, testPatterns = ["*.spec.ts", "*.test.ts"], testDirs = ["", "__tests__", "tests"]) {
    const sourceFileDir = path_1.default.dirname(sourceFilePath);
    // Iterate over each test directory configured
    for (const testDir of testDirs) {
        const testDirPath = path_1.default.join(sourceFileDir, testDir); // Compute potential test directory path
        for (const pattern of testPatterns) {
            // Construct the full search pattern for the files
            const searchPattern = path_1.default.join(testDirPath, pattern);
            try {
                // Search for files matching the pattern in the computed directory
                const files = await (0, glob_promise_1.default)(searchPattern, { nodir: true }); // Use glob to find files matching the pattern
                if (files.length > 0) {
                    return files[0]; // Return the path of the first matching file found
                }
            }
            catch (error) {
                // Log errors related to file searching
                console.error(`Error searching files in directory ${testDirPath} with pattern ${pattern}: ${error}`);
            }
        }
    }
    // Return null if no matching test files are found after all attempts
    return null;
}
async function getChangedFiles(workingDirectory, overrideDiff) {
    await (0, utils_1.executeGitCommand)("git fetch origin main", workingDirectory); // Ensure we're comparing against the latest main
    const output = overrideDiff ||
        (await (0, utils_1.executeGitCommand)("git diff --name-only FETCH_HEAD", workingDirectory));
    return output.split("\n").filter((line) => line.length > 0);
}
// Function to parse git diff and extract changed line numbers
function parseDiff(diff) {
    const changedLines = [];
    const lines = diff.split("\n");
    let currentLineNumber = 0;
    for (const line of lines) {
        if (line.startsWith("@@")) {
            // Extract the starting line number from the hunk header
            const match = /@@ -\d+,\d+ \+(\d+),/.exec(line);
            if (match) {
                currentLineNumber = parseInt(match[1], 10) - 1; // Set the line number to the starting line of the diff hunk
            }
        }
        else if (line.startsWith("+") && !line.startsWith("+++")) {
            changedLines.push(currentLineNumber);
        }
        // Increment the current line number for lines in the new file
        if (!line.startsWith("-") && !line.startsWith("@@")) {
            currentLineNumber++;
        }
    }
    return changedLines;
}
// export function findEnclosingNodes(
//   ast: TSESTree.Node,
//   changedLines: number[],
//   document: vscode.TextDocument
// ): TSESTree.Node[] {
//   const enclosingNodes: TSESTree.Node[] = [];
//   const nodeSet = new Set<TSESTree.Node>();
//   changedLines.forEach((line) => {
//     const offset = document.offsetAt(new vscode.Position(line, 0));
//     const node = findEnclosingNode(ast, offset);
//     if (
//       node &&
//       !nodeSet.has(node) &&
//       !node.type.includes("Import") &&
//       node.type !== "Program"
//     ) {
//       nodeSet.add(node);
//       enclosingNodes.push(node);
//     }
//   });
//   return enclosingNodes;
// }
class Position {
    line;
    character;
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}
class TextDocument {
    content;
    lines;
    constructor(content) {
        this.content = content;
        this.lines = content.split("\n");
    }
    offsetAt(position) {
        let offset = 0;
        for (let i = 0; i < position.line; i++) {
            offset += this.lines[i].length + 1; // +1 for newline character
        }
        return offset + position.character;
    }
    getText(range) {
        if (!range)
            return this.content;
        const startOffset = this.offsetAt(range.start);
        const endOffset = this.offsetAt(range.end);
        return this.content.slice(startOffset, endOffset);
    }
}
function findEnclosingNodes(ast, changedLines, document) {
    const enclosingNodes = [];
    const nodeSet = new Set();
    changedLines.forEach((line) => {
        const offset = document.offsetAt(new Position(line, 0));
        const node = findEnclosingNode(ast, offset);
        if (node &&
            !nodeSet.has(node) &&
            !node.type.includes("Import") &&
            node.type !== "Program") {
            nodeSet.add(node);
            enclosingNodes.push(node);
        }
    });
    return enclosingNodes;
}
exports.findEnclosingNodes = findEnclosingNodes;
// export async function openFilesInEditor(files: string[]) {
//   const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
//   if (!workspaceFolder) {
//     console.error("Workspace not found.");
//     return;
//   }
//   let viewColumn = vscode.ViewColumn.Beside;
//   for (const file of files) {
//     const filePath = vscode.Uri.file(path.join(workspaceFolder, file));
//     try {
//       const document = await vscode.workspace.openTextDocument(filePath);
//       await vscode.window.showTextDocument(document, {
//         preview: false,
//         viewColumn,
//       });
//       viewColumn = vscode.ViewColumn.Beside; // Open next file beside the current one
//     } catch (error) {
//       try {
//         const document = await vscode.workspace.openTextDocument(file);
//         await vscode.window.showTextDocument(document, {
//           preview: false,
//           viewColumn,
//         });
//         viewColumn = vscode.ViewColumn.Beside; // Open next file beside the current one
//       } catch (error) {
//         console.error(error);
//       }
//     }
//   }
// }
async function collectAndDisplaySnippets(file, workspaceFolder, overrideDiff) {
    const filePath = path_1.default.join(workspaceFolder, file);
    const text = await fs_1.default.promises.readFile(filePath, { encoding: "utf-8" });
    const document = new TextDocument(text);
    try {
        const ast = (0, typescript_estree_1.parse)(text, { loc: true, range: true, jsx: false });
        const diff = overrideDiff ||
            (await (0, utils_1.executeGitCommand)(`git diff FETCH_HEAD -- ${file}`, workspaceFolder));
        const changedLines = parseDiff(diff);
        const enclosingNodes = findEnclosingNodes(ast, changedLines, document);
        console.log({ diff, changedLines, enclosingNodes });
        const snippets = enclosingNodes
            .map((node) => {
            if (node.loc) {
                const start = new Position(node.loc.start.line - 1, node.loc.start.column);
                const end = new Position(node.loc.end.line - 1, node.loc.end.column);
                return document.getText({ start, end });
            }
            return "";
        })
            .filter((snippet) => snippet !== "");
        return {
            codeWithoutReferences: snippets,
            codeWithReferences: await Promise.all(snippets.map(async (snippet) => {
                const codeWithReferences = await (0, utils_1.extractCodeAndReferences)([filePath], [snippet.slice(0, utils_1.TOKEN_MAX_LENGTH)], 3);
                return codeWithReferences;
            })),
            gitDiff: diff,
        };
    }
    catch (error) {
        console.error("Failed to parse file: " + file, error);
        return null; // Return empty or handle the error appropriately
    }
}
/**
 * Finds the test file path based on the source file path and given test patterns and directories.
 *
 * @param sourceFilePath The full path to the source file for which tests are being sought.
 * @param testPatterns An array of test file patterns to match.
 * @param testDirs An array of directory names that typically contain test files.
 * @returns A promise that resolves to the path of the first matching test file, or null if no match is found.
 */
async function findTestFilePath(sourceFilePath, testPatterns = ["*.spec.ts", "*.test.ts"], testDirs = ["", "__tests__", "tests"]) {
    const fullPath = path_1.default.resolve(sourceFilePath);
    const sourceFileDir = path_1.default.dirname(fullPath);
    const baseName = path_1.default.basename(sourceFilePath, path_1.default.extname(sourceFilePath)); // Base filename without extension
    const extension = path_1.default.extname(sourceFilePath); // The extension of the source file
    // Iterate through potential directories, including the current directory
    for (const testDir of testDirs) {
        const testDirPath = path_1.default.join(sourceFileDir, testDir);
        console.log(`Test Directory Path: ${testDirPath}`);
        for (const pattern of testPatterns) {
            // Ensure the pattern does not include wildcards or multiple extensions
            let cleanPattern = pattern.replace("*", ""); // Remove any wildcard characters
            if (!cleanPattern.endsWith(extension)) {
                cleanPattern += extension; // Ensure the extension is added only once
            }
            const testFileName = `${baseName}${cleanPattern}`;
            const testFilePath = path_1.default.join(testDirPath, testFileName);
            console.log(`Checking Test File Path: ${testFilePath}`);
            // Check if the test file exists using Node.js fs module
            try {
                await fs_1.default.promises.stat(testFilePath);
                return testFilePath; // If file exists, return the path
            }
            catch (error) {
                // File does not exist, continue checking
            }
        }
    }
    return null; // Return null if no test file path is found
}
/**
 * Generates a test file name from a given source file path using verified test patterns from the project.
 * Ensures the pattern is already used within the current project before suggesting a test file name.
 *
 * @param {string} sourceFilePath - The full path to the source file.
 * @param {string[]} testPatterns - The patterns to recognize test files.
 * @param {string[]} testDirs - The directories to search for test files.
 * @returns {Promise<string | null>} - The test file name or null if no suitable pattern is found.
 */
async function generateTestFileName(sourceFilePath, testPatterns = ["*.spec.ts", "*.test.ts"], testDirs = ["", "__tests__", "tests"]) {
    if (!testPatterns.length || !testDirs.length) {
        return null; // Early return if configuration is inadequate
    }
    const dirPath = path_1.default.dirname(sourceFilePath);
    const baseName = path_1.default.basename(sourceFilePath, path_1.default.extname(sourceFilePath));
    const extension = path_1.default.extname(sourceFilePath);
    // Iterate over each pattern to find one that is already being used in the project
    for (const pattern of testPatterns) {
        const cleanedPattern = cleanPattern(pattern, extension);
        const patternExists = await checkPatternInProject(dirPath, cleanedPattern);
        if (patternExists) {
            const testFileName = `${baseName}${cleanedPattern}`;
            return testFileName; // Return just the file name
        }
    }
    return null; // No suitable pattern found that's already in use
}
// /**
//  * Checks if a given pattern is used in any file within the project directory.
//  *
//  * @param {string} projectDir - The base directory of the current project.
//  * @param {string} pattern - The file naming pattern to check.
//  * @returns {Promise<boolean>} - True if the pattern is found, false otherwise.
//  */
// async function checkPatternInProject(
//   projectDir: string,
//   pattern: string
// ): Promise<boolean> {
//   const searchPattern = new vscode.RelativePattern(projectDir, `*${pattern}*`);
//   const files = await vscode.workspace.findFiles(searchPattern, null, 1); // Search for at least one match
//   return files.length > 0;
// }
/**
 * Checks if a given pattern is used in any file within the project directory.
 *
 * @param {string} projectDir - The base directory of the current project.
 * @param {string} pattern - The file naming pattern to check.
 * @returns {Promise<boolean>} - True if the pattern is found, false otherwise.
 */
async function checkPatternInProject(projectDir, pattern) {
    try {
        const files = await fs_1.default.promises.readdir(projectDir);
        return files.some((file) => file.includes(pattern));
    }
    catch (error) {
        console.error(`Error searching for files: ${error}`);
        return false;
    }
}
/**
 * Cleans a test pattern by removing wildcards and ensuring it contains the correct file extension.
 *
 * @param {string} pattern - The pattern configured in settings.
 * @param {string} extension - The file extension derived from the source file.
 * @returns {string} - The cleaned pattern ready to use for filename construction.
 */
function cleanPattern(pattern, extension) {
    let cleanPattern = pattern.replace(/\*/g, ""); // Remove any wildcard characters
    if (!pattern.includes(extension)) {
        cleanPattern += extension; // Append the extension only if not already included
    }
    return cleanPattern;
}
// /**
//  * Cleans a test pattern by removing wildcards and ensuring it contains the correct file extension.
//  *
//  * @param {string} pattern - The pattern configured in settings.
//  * @param {string} extension - The file extension derived from the source file.
//  * @returns {string} - The cleaned pattern ready to use for filename construction.
//  */
// function cleanPattern(pattern: string, extension: string): string {
//   let cleanPattern = pattern.replace(/\*/g, ""); // Remove any wildcard characters
//   if (!pattern.includes(extension)) {
//     cleanPattern += extension; // Append the extension only if not already included
//   }
//   return cleanPattern;
// }
activate();
//# sourceMappingURL=index.js.map
import * as fs from "fs";
import { uniq, uniqBy } from "lodash";
import * as path from "path";
import * as readline from "readline";
import * as tsConfigPaths from "tsconfig-paths";
import * as ts from "typescript";
import { sendMessageToAssistant, sendMessageToChatGPT } from "./openai-utils";
const stripJsonComments = import("strip-json-comments");

import { exec } from "child_process";
import { stringTokens } from "openai-chat-tokens";
import {
  generateCodeToInsertIntoExistingFile,
  replaceAllCodeInFile,
} from "./existingFile.utils";
import {
  currentGitDiff,
  fromHighlightedCode,
  progressBar,
  selectedCodeWithoutReferences,
} from "./index";

let allCode: string = "";
let usedAsts: string[] = [];
let reachedLimit: boolean = false;

export const delay = async (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const TOKEN_MAX_LENGTH = 300;
// /**
//  * Appends a directory to the .gitignore file in the workspace.
//  * @param directoryPath The directory path to add to .gitignore.
//  */
// export async function addToGitignore(directoryPath: string): Promise<void> {
//   const workspaceFolders = vscode.workspace.workspaceFolders;
//   if (!workspaceFolders) {
//     console.error("No workspace is open.");
//     return;
//   }

//   const gitignorePath = path.join(workspaceFolders[0].uri.fsPath, ".gitignore");
//   const fileUri = vscode.Uri.file(gitignorePath);

//   try {
//     // Try to read the existing .gitignore
//     let content = "";
//     try {
//       const uint8Array = await vscode.workspace.fs.readFile(fileUri);
//       content = new TextDecoder().decode(uint8Array);
//     } catch (readError) {
//       // @ts-ignore
//       if (readError.code !== "FileNotFound") {
//         throw readError; // Re-throw if it's not a file not found error
//       }
//       // If file does not exist, we'll create one.
//     }

//     // Check if the directory is already in the .gitignore
//     if (content.includes(directoryPath)) {
//       // console.info(
//       //   `${directoryPath} is already in .gitignore.`
//       // );
//       return;
//     }

//     // Append the new directory path
//     const newContent = content + (content ? "\n" : "") + directoryPath + "\n";

//     // Write the updated content back to .gitignore
//     const enc = new TextEncoder();
//     await vscode.workspace.fs.writeFile(fileUri, enc.encode(newContent));
//     console.info(`${directoryPath} added to .gitignore.`);
//   } catch (error) {
//     console.error(`Failed to update .gitignore: ${error}`);
//   }
// }
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

export async function parseCodeForASTs(
  filePath: string,
  searchValue: string,
  typeSearch?: string,
  searchValueIsAnyIdentifier?: boolean,
  debug?: boolean
): Promise<{ ast: string; code: string; path: string; astObj: ts.Node }[]> {
  let fileContents = filePath && ts.sys.readFile(filePath);
  if (!fileContents || !filePath) {
    console.error(`Failed to read file: ${filePath}`);
    return [];
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    fileContents,
    ts.ScriptTarget.Latest,
    true
  );

  let arr: { ast: string; code: string; path: string; astObj: ts.Node }[] = [];

  function serializeAST(node: ts.Node, indentLevel: number = 0): string {
    let serializedAst = "";
    function appendOutput(output: string): void {
      serializedAst += output + "\n";
    }

    (function serialize(node: ts.Node, indentLevel: number = 0): void {
      appendOutput(
        `${" ".repeat(indentLevel * 2)}${ts.SyntaxKind[node.kind]}: ${node
          .getText()
          .trim()}`
      );
      node.forEachChild((child) => serialize(child, indentLevel + 1));
    })(node);

    return serializedAst;
  }

  function processNode(node: ts.Node) {
    const text = node.getText(sourceFile);
    if (debug) {
      // console.log({
      //   code: text,
      //   minimizedCode: minimizeCode(text),
      //   searchValue,
      //   // searchRegex,
      //   filePath,
      // });
    }
    if (
      !searchValue ||
      text.includes(searchValue) ||
      text.replace(/[^\w]/g, "").includes(searchValue.replace(/[^\w]/g, "")) ||
      minimizeCode(text)
        .replace(/[^\w]/g, "")
        .includes(minimizeCode(searchValue).replace(/[^\w]/g, ""))
    ) {
      const snippet = node.getText(sourceFile);
      const astSegment = serializeAST(node).trim();
      if (
        filePath &&
        (!typeSearch ||
          (searchValueIsAnyIdentifier
            ? astSegment.includes(typeSearch)
            : astSegment.startsWith(typeSearch)))
      ) {
        // console.log('pushing ', snippet.trim())
        arr.push({
          ast: astSegment,
          astObj: node,
          code: snippet.trim(),
          path: filePath,
        });
      }
    }

    ts.forEachChild(node, processNode);
  }

  processNode(sourceFile);
  return arr;
}

export const extractCodeAndReferences = async (
  filePaths: string[],
  codeIdentifiers: string[],
  layers: number = 3,
  pos?: number
) => {
  usedAsts = [];
  allCode = "";
  // console.log({usedAsts})
  let codeForContext = "";
  // console.log({ filePaths, codeIdentifiers });
  if (filePaths.length === 0 || codeIdentifiers.length === 0) {
    return "";
  }
  reachedLimit = false;
  for (const filePath of filePaths) {
    for (const codeIdentifier of codeIdentifiers) {
      // console.log("iterating ", filePath, codeIdentifier);
      codeForContext += await extractCodeFromASTsInPath(
        filePath,
        codeIdentifier,
        layers,
        1,
        pos
      );
    }
  }

  return codeForContext;
};

const extractCodeFromASTsInPath = async (
  filePath: string,
  codeIdentifier: string,
  layers: number,
  onLayer: number,
  pos?: number
) => {
  let model: "GPT-4" = "GPT-4";

  if (layers === onLayer) {
    return "";
  }

  let codeForContext = "";
  const importDeclarations = await parseCodeForASTs(
    filePath,
    "",
    "ImportDeclaration"
  );
  // console.log({importDeclarations, filePath, codeIdentifier})
  const asts = await parseCodeForASTs(filePath, codeIdentifier);
  let astsArray = uniqBy(asts, "ast").filter(({ ast, astObj }) => {
    return !ast.startsWith("SourceFile") && !ast.startsWith("Import") && pos
      ? Math.abs(astObj.pos - pos) < 20
      : true;
  }); //.filter(({ast})=>ast.startsWith('ExpressionStatement'));
  astsArray = astsArray.length
    ? [
        astsArray.find(
          (ast) =>
            (ast.astObj as any)["name"] &&
            (ast.astObj as any)["name"]["escapedText"] === codeIdentifier
        ) || astsArray[0],
      ]
    : [];

  for (const { ast, path, code } of astsArray.length ? [astsArray[0]] : []) {
    if (
      usedAsts.includes(ast.slice(0, TOKEN_MAX_LENGTH)) ||
      usedAsts.includes(code.slice(0, TOKEN_MAX_LENGTH))
    ) {
      continue;
    }
    usedAsts.push(ast.slice(0, TOKEN_MAX_LENGTH));
    usedAsts.push(code.slice(0, TOKEN_MAX_LENGTH));

    codeForContext += `/*file:${path}*/`;

    const identifierPattern1 = /Identifier: (\w+)/g;
    let match;
    let identifiers: string[] = []; //identifierPattern1.exec(ast) || [];
    while ((match = identifierPattern1.exec(ast)) !== null) {
      identifiers.push(match[1]); // match[1] is the captured group, which is the identifier
    }
    let match2;
    let importIdentifiers: string[] = []; //identifierPattern1.exec(ast) || [];
    for (const importDeclaration of importDeclarations) {
      while (
        (match2 = identifierPattern1.exec(importDeclaration.ast)) !== null
      ) {
        importIdentifiers.push(match2[1].toLowerCase()); // match[1] is the captured group, which is the identifier
      }
    }

    identifiers = uniq(identifiers).filter((id) =>
      importIdentifiers.includes(id.toLowerCase())
    );

    for (const identifier of identifiers) {
      const referencedIdentifierASTs = await parseCodeForASTs(
        path,
        identifier,
        "ImportDeclaration:"
      );

      if (!referencedIdentifierASTs.length) {
        continue;
      }
      const findImportPatter = new RegExp(`Identifier:\\s*${identifier}`, "i");
      let imports = referencedIdentifierASTs.filter(
        ({ ast }) =>
          ast.startsWith("ImportDeclaration:") && findImportPatter.test(ast)
      );
      imports = uniqBy(imports, (i) => "ast");
      imports = imports.filter(
        ({ ast: i, code: i2 }) =>
          !usedAsts.includes(i.slice(0, TOKEN_MAX_LENGTH)) &&
          !usedAsts.includes(i2.slice(0, TOKEN_MAX_LENGTH))
      );

      usedAsts.push(...imports.map((a) => a.ast.slice(0, TOKEN_MAX_LENGTH)));
      usedAsts.push(...imports.map((a) => a.code.slice(0, TOKEN_MAX_LENGTH)));

      for (const { code } of imports) {
        codeForContext += addCode(code, model);
        codeForContext += addCode("\n", model);
      }
    }

    codeForContext += addCode("\n", model);

    if (onLayer === 1) {
      codeForContext += addCode(`/*PRIMARY CODE STARTS HERE*/`, model);
    }

    codeForContext += addCode("\n\n", model);
    codeForContext += addCode(code, model);
    codeForContext += addCode("\n\n", model);

    for (const identifier of identifiers) {
      const referencedIdentifierASTs = await parseCodeForASTs(
        path,
        identifier,
        "ImportDeclaration:"
      );
      if (!referencedIdentifierASTs.length) {
        continue;
      }

      // find the imports for those identifiers
      // const findImportPatter = /^ImportDeclaration:.*?Identifier:\s*{express}/;
      const findImportPatter = new RegExp(`Identifier:\\s*${identifier}`, "i");
      let imports = referencedIdentifierASTs.filter(({ ast }) => {
        return (
          ast.startsWith("ImportDeclaration") && findImportPatter.test(ast)
        );
      });

      imports = uniqBy(imports, (i) => i.ast);

      for (const { ast, code, astObj } of imports) {
        const { identifiers, path: relativePath } =
          await getIdentifiersAndPathFromImport(path, ast, astObj, code);
        for (const identifier of identifiers) {
          if (!relativePath) {
            continue;
          }

          const absolutePath = relativePath;
          if (!absolutePath) {
            continue;
          }

          if (!absolutePath || !identifier) {
            continue;
          }
          codeForContext += await extractCodeFromASTsInPath(
            absolutePath,
            identifier,
            layers,
            onLayer + 1
          );
        }
      }
    }
  }
  if (onLayer === 1) {
    if (reachedLimit) {
      console.info(
        "Truncating code to copy since it hit the token limit for this model. Try selecting a smaller subset of the code"
      );
    }
  }

  return codeForContext;
};

const getIdentifiersAndPathFromImport = async (
  fromPath: string,
  ast: string,
  astObj: ts.Node,
  code: string
) => {
  // console.log({ codeforidentifierandpath: ast });
  const identifierPattern2 = /Identifier: ([^\n]+)/g;
  const stringLiteralPattern = /StringLiteral: \"([^\"]+)\"/g;

  // const identifierMatches = identifierPattern2.exec(ast);
  const identifierMatches: string[] = [];
  let match1;
  // console.log({ast})
  let i = 0;
  while ((match1 = identifierPattern2.exec(ast)) !== null) {
    if (i == 50) break;
    if (match1[1]) {
      identifierMatches.push(match1[1]); // match[1] is the captured group, which is the identifier
    }
    i++;
  }
  // console.log({identifiers: identifierMatches})
  // let match2;
  // const stringLiteralMatches: string[] = []; //identifierPattern1.exec(ast) || [];
  // while ((match2 = stringLiteralPattern.exec(ast)) !== null) {
  //   stringLiteralMatches.push(match2[1]); // match[1] is the captured group, which is the identifier
  // }
  const stringLiteralMatches = stringLiteralPattern.exec(ast);

  // const identifierMatch =
  //   (identifierMatches?.length && identifierMatches[1]) || null;
  const lastStringLiteralMatch /* path of the import */ =
    (stringLiteralMatches?.length &&
      stringLiteralMatches[stringLiteralMatches.length - 1]) ||
    null;

  try {
    // console.log('opening document: ', fromPath)
    // const document = await vscode.workspace.openTextDocument(fromPath);
    // console.log('done opening document: ', fromPath)
    // const position = findPositionOfImport(document, lastStringLiteralMatch || '');
    // if (position) {
    // console.log('start resolving: ', lastStringLiteralMatch)
    const resolvedPath = await resolveImportPath(
      fromPath,
      lastStringLiteralMatch || ""
    ); /*.catch((err) => {
      console.error(err);
      return lastStringLiteralMatch;
    });*/
    // if (!resolvedPath) {
    //   return lastStringLiteralMatch;
    // }
    // console.log('finished resolving: ', lastStringLiteralMatch)
    if (resolvedPath) {
      if (!resolvedPath.includes("node_modules")) {
        // console.log('Resolved Path:', resolvedPath);
        // return { identifier: identifierMatch, path: resolvedPath };
        return { identifiers: identifierMatches, path: resolvedPath };
      }
    } else {
      // console.error('Failed to resolve path.');
    }
    // } else {
    //     // console.log('Import statement not found.');
    // }
    // const node = astObj
    //   if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    //     if (node.moduleSpecifier.text === importPath) {
    //         const compilerOptions = ts.getDefaultCompilerOptions();
    //         const result = ts.resolveModuleName(importPath, document.uri.fsPath, compilerOptions, ts.sys);

    //         if (result.resolvedModule) {
    //             return result.resolvedModule.resolvedFileName;
    //         }
    //     }
    // }
    // const matches = [...ast.matchAll(stringLiteralPattern)].map(m => m[1]);
    // const lastStringLiteralMatch = matches.pop(); // Extracts the last element from the array
  } catch (error) {
    console.error(error);
    return { identifiers: identifierMatches, path: lastStringLiteralMatch };
  }

  return { identifiers: identifierMatches, path: lastStringLiteralMatch };
};
// /**
//  * Finds and resolves the import path from a specific file and import statement.
//  * @param absoluteFilePath The absolute path to the file containing the import statement.
//  * @param importText The exact text of the import to resolve (e.g., './myModule').
//  * @returns A promise that resolves to the absolute path of the resolved module or undefined if not resolved.
//  */
// async function resolveImportPath(
//   absoluteFilePath: string,
//   importStatement: string
// ): Promise<string | undefined> {
//   const document = await vscode.workspace.openTextDocument(absoluteFilePath);
//   const text = document.getText();
//   // console.log({ importStatement, text });
//   const importIndex = text.indexOf(importStatement);

//   if (importIndex === -1) {
//     console.error("Import statement not found in document.");
//     return undefined;
//   }

//   const position = document.positionAt(importIndex);
//   const locations: vscode.Location[] = await vscode.commands.executeCommand(
//     "vscode.executeDefinitionProvider",
//     document.uri,
//     position
//   );

//   if (!locations || locations.length === 0) {
//     console.error("No definition found for the given position.");
//     return undefined;
//   }

//   // Assuming the first location is the correct one
//   return (
//     locations[0].uri?.fsPath ||
//     locations[0].uri?.path ||
//     // @ts-ignore
//     locations[0]["targetUri"]?.fsPath ||
//     // @ts-ignore
//     locations[0]["targetUri"]?.path
//   ); //.targetUri.fsPath;
// }
/**
 * Finds and resolves the import path from a specific file and import statement.
 * @param absoluteFilePath The absolute path to the file containing the import statement.
 * @param importStatement The exact text of the import to resolve (e.g., './myModule').
 * @returns A promise that resolves to the absolute path of the resolved module or undefined if not resolved.
 */
async function resolveImportPath(
  importingFilePath: string,
  importPath: string
): Promise<string> {
  let tsConfig: any;
  try {
    const tsConfigRaw = fs.readFileSync("tsconfig.json", "utf-8");
    // console.info(tsConfigStr);
    tsConfig = JSON.parse((await stripJsonComments)(tsConfigRaw));
  } catch (error) {
    // console.error(error);
    return importPath;
  }

  if (!tsConfig.compilerOptions || !tsConfig.compilerOptions.baseUrl) {
    throw new Error("baseUrl is not set in tsconfig.json");
  }

  const baseUrl = path.resolve(tsConfig.compilerOptions.baseUrl);
  const matchPath = tsConfigPaths.createMatchPath(
    baseUrl,
    tsConfig.compilerOptions.paths || {}
  );

  // console.log("Base URL:", baseUrl);
  // console.log("Import Path:", importPath);
  // console.log("Importing File Path:", importingFilePath);

  // First, try to resolve using tsconfig paths
  let result = matchPath(importPath);

  if (result) {
    console.log("Resolved using tsconfig paths:", result);
    if (checkFileExistence(path.resolve(result))) {
      return checkFileExistence(path.resolve(result))!;
    }
  }

  // If no match is found, resolve relative to the importing file's directory
  const importingDir = path.dirname(importingFilePath);
  result = path.resolve(importingDir, importPath);

  // Normalize the resulting path
  const resolvedPath = path.normalize(result);
  // console.log("Resolved relative path:", resolvedPath);

  // Check if the path incorrectly repeats part of the path
  if (resolvedPath.includes("/src/tasks/api/routes/src/")) {
    const correctedPath = resolvedPath.replace(
      "/src/tasks/api/routes/src/",
      "/src/"
    );
    console.log("Corrected path:", correctedPath);
    if (checkFileExistence(correctedPath)) {
      return checkFileExistence(correctedPath)!;
    }
  }

  return resolvedPath;
}
function removeCommentsAndTrailingCommas(jsonString: string): string {
  // Remove single-line comments
  let noComments = jsonString.replace(/\/\/.*$/gm, "");
  // Remove multi-line comments
  noComments = noComments.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove trailing commas
  let noTrailingCommas = noComments.replace(/,\s*}/g, "}");
  noTrailingCommas = noTrailingCommas.replace(/,\s*]/g, "]");

  return noTrailingCommas;
}

// Function to check if a file exists with or without extensions
function checkFileExistence(filePath: string): string | null {
  if (filePath.includes("node_modules")) {
    return null;
  }
  if (filePath.includes("dist/")) {
    return null;
  }
  if (filePath.includes("out/")) {
    return null;
  }
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  if (fs.existsSync(`${filePath}.ts`)) {
    return `${filePath}.ts`;
  }
  if (fs.existsSync(`${filePath}.js`)) {
    return `${filePath}.js`;
  }
  return null;
}
// async function resolveImportPath(
//   absoluteFilePath: string,
//   importStatement: string
// ): Promise<string | undefined> {
//   try {
//     const text = fs.readFileSync(absoluteFilePath, "utf-8");
//     const sourceFile = ts.createSourceFile(
//       absoluteFilePath,
//       text,
//       ts.ScriptTarget.Latest
//     );

//     let resolvedPath: string | undefined;

//     const visitNode = (node: ts.Node) => {
//       if (
//         ts.isImportDeclaration(node) &&
//         node.moduleSpecifier.getText(sourceFile).includes(importStatement)
//       ) {
//         const importPath = node.moduleSpecifier
//           .getText(sourceFile)
//           .slice(1, -1); // Remove quotes
//         const directoryPath = path.dirname(absoluteFilePath);
//         resolvedPath = require.resolve(path.join(directoryPath, importPath));
//         if (!resolvedPath) {
//           resolvedPath = require.resolve(
//             path.join(directoryPath, `${importPath}.ts`)
//           );
//         }
//         if (!resolvedPath) {
//           resolvedPath = require.resolve(
//             path.join(directoryPath, `${importPath}.js`)
//           );
//         }
//       }
//       ts.forEachChild(node, visitNode);
//     };

//     ts.forEachChild(sourceFile, visitNode);

//     if (!resolvedPath) {
//       console.error("Import statement not found in document.");
//     }

//     return resolvedPath;
//   } catch (error) {
//     console.error(`Couldn't resolve the import statement: ${importStatement}`);
//     console.error("Error resolving import path:", error);
//     return undefined;
//   }
// }

export const minimizeCodeByLines = (code: string): string => {
  return code
    .split("\n")
    .map((line) => line.replace(/"/g, '\\"'))
    .join("\\n");
};

export const convertCodeStringBackToCode = (str: string): string => {
  return str.replace(/\\n/g, "\n").replace(/\\"/g, '"');
};

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

  // Optional: Shorten common variable names, this part is very customizable
  // code = code.replace(/\b(document|window|console|element)\b/g, (fullMatch) => {
  //   const mappings: { [key: string]: string } = {
  //     'document': 'doc',
  //     'window': 'win',
  //     'console': 'con',
  //     'element': 'el'
  //   };
  //   return mappings[fullMatch];
  // });

  // Trim leading and trailing spaces
  code = code.trim();

  return code;
};

export const addCode = (
  newCodeUncompressed: string,
  model?: "GPT-3.5" | "GPT-4",
  isPrimaryCode?: boolean
): string => {
  const newCode = minimizeCode(newCodeUncompressed);
  let normalizedModel: "gpt-3.5-turbo" | "gpt-4" | null = null;
  switch (model) {
    case "GPT-3.5":
      normalizedModel = "gpt-3.5-turbo";
      break;
    case "GPT-4":
      normalizedModel = "gpt-4";
      break;

    default:
      allCode += newCode;
      return newCode;
  }

  const tokenCount = stringTokens(allCode + newCode);
  switch (normalizedModel) {
    case "gpt-3.5-turbo":
      if (tokenCount > 4096) {
        reachedLimit = true;
        return "";
      }
      break;
    case "gpt-4":
      if (tokenCount > 4096) {
        // if (tokenCount > 8192) {
        reachedLimit = true;
        return "";
      }

      break;

    default:
      allCode += newCode;
      return newCode;
  }
  allCode += newCode;
  return newCode;
};

interface SearchParameters {
  startString: string;
  lineNumber: number;
}

// Function to find the code block
export const findCodeBlock = async (
  filePath: string,
  params: SearchParameters
) => {
  const { startString, lineNumber } = params;

  const parsed = await parseCodeForASTs(
    filePath,
    startString,
    undefined,
    undefined
  );
  const result = parsed.find(({ code }) => {
    return minimizeCode(code)
      .trim()
      .replace(/[^\w]/g, "")
      .startsWith(startString.trim().replace(/[^\w]/g, ""));
  });
  return result;
};
/**
 * Handles creating a new test file and writing tests into it based on the context of an existing file.
 * @param editor The active text editor.
 * @param contextTestFile The file path of the context test file.
 * @param context The extension context provided by VSCode.
 */
export const writeTestsToNewFile = async (
  filePath: string,
  contextTestFile: string,
  autoNewFileName: string
): Promise<void> => {
  const newTestFilePath = await createNewTestFile(filePath, autoNewFileName);
  if (!newTestFilePath) {
    console.info("Failed to create new test file.");
    return;
  }
  // await openFilesInEditor([newTestFilePath]);

  const modifiedTestCodeForContext =
    await getMinimizedTestCodeWithRefToModifyOrContext(contextTestFile, "new");
  if (!modifiedTestCodeForContext?.codeBlockWithRefToModify) {
    throw new Error(
      "Something went wrong with getting code from test file used for context"
    );
  }
  progressBar.update(50);
  // add other test file to context
  await sendMessageToAssistant(
    `also use this test code for context. await my further instructions ${
      modifiedTestCodeForContext?.codeBlockWithRefToModify || ""
    }`
  );

  let codeToAdd = await generateInsertionCode(
    "", // not needed for new test file generation
    "new",
    newTestFilePath
  );

  if (codeToAdd) {
    progressBar.update(80);
    await insertTextToFile(newTestFilePath, 0, codeToAdd); // Insert at the beginning of the new file
    codeToAdd = await addOrUpdateAnyMissingTestsAndOverwriteFile(
      newTestFilePath,
      codeToAdd
    );
    // codeToAdd = await fixErrorsInCodeAndOverwriteFile(
    //   newTestFilePath,
    //   codeToAdd
    // );

    // let document = await vscode.workspace.openTextDocument(newTestFilePath); // Open the document
    // await document.save();

    console.info("New test file created and tests inserted successfully.");
  } else {
    console.error("Failed to generate test code.");
  }
};

// const overwriteFileContent = async (filePath: string, content: string) => {
//   try {
//     const uri = vscode.Uri.file(filePath);
//     const encoder = new TextEncoder(); // Built-in utility for encoding strings
//     await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
//     console.log("File content overwritten successfully.");
//   } catch (err) {
//     console.error("Failed to overwrite file content:", err);
//   }
// };

// export const fixErrorsInCodeAndOverwriteFile = async (
//   filePath: string,
//   code: string,
//   isPartialCode?: boolean,
//   overrideOverwrite?: (codeToAdd: string) => Promise<void>,
//   errors?: string[]
// ) => {
//   let codeToAdd = isPartialCode ? await unminimizeCodeFromFile(filePath) : code;
//   let i = 0;
//   let reflectionIterationMax = 4;
//   let errorsParam: string[] | undefined | null = errors;
//   await delay(2000);
//   while (i < reflectionIterationMax) {
//     const errorsInFile =
//       errorsParam || (await getTypeScriptErrors(filePath)) || [];
//     errorsParam = null;
//     console.log({ errorsinfile: errorsInFile.join("\n") });
//     if (!errorsInFile.length) {
//       i++;
//       break;
//     }
//     const fixedCodeStr = await sendMessageToAssistant(
//       `The code you added

//       ${isPartialCode ? codeToAdd : ""}

//         resulted in these errors. please fix it and return ALL of the fixed code. Your response should only contain code in the json format {"code": string}. the code should only be the code you've given me in this conversation

//         ${errorsInFile.join("\n")}

//         Your response should only contain code in the json format {"code": string}
//         `,
//       "gpt-4o",
//       `Your response should only contain code in the json format {"code": string}`
//     );
//     let fixedCodeJSON: { code: string } | null = null;
//     try {
//       fixedCodeJSON = JSON.parse(
//         fixedCodeStr?.message?.replace(/```json/g, "").replace(/```/g, "") || ""
//       );
//     } catch (error) {
//       console.error(error);
//     }
//     if (fixedCodeJSON?.code) {
//       const fixedCode = fixedCodeJSON?.code || "";
//       codeToAdd = fixedCode;
//       if (overrideOverwrite) {
//         await overrideOverwrite(codeToAdd);
//       } else {
//         await overwriteFileContent(filePath, fixedCode);
//       }
//     }
//     await delay(2000);
//     i++;
//   }

//   return codeToAdd;
// };

// export const fixErrorsInCodeAndOverwriteFile2 = async (filePath: string) => {
//   let i = 0;
//   let reflectionIterationMax = 4;
//   let errorsParam: string[] | undefined | null = null;
//   await delay(2000);
//   let codeToAdd = "";
//   while (i < reflectionIterationMax) {
//     const errorsInFile =
//       errorsParam || (await getTypeScriptErrors(filePath)) || [];
//     errorsParam = null;
//     console.log({ errorsinfile: errorsInFile.join("\n") });
//     if (!errorsInFile.length) {
//       i++;
//       break;
//     }
//     codeToAdd = await insertCodeIntoExistingCode(
//       filePath,
//       `
//     The code you added resulted in these errors please fix them

//     ${errorsInFile.join("\n")}
//     `
//     );
//     await overwriteFileContent(filePath, codeToAdd);

//     await delay(2000);
//     vscode.commands.executeCommand("editor.action.autoFix");
//     await delay(2000);
//     i++;
//   }

//   return codeToAdd;
// };
export const addOrUpdateAnyMissingTestsAndOverwriteFile = async (
  filePath: string,
  code: string,
  isPartialCode?: boolean,
  overrideOverwrite?: (codeToAdd: string) => Promise<void>
) => {
  let codeToAdd = code;
  let i = 0;
  let reflectionIterationMax = 0;
  while (i < reflectionIterationMax) {
    const fixedCodeStr = await sendMessageToAssistant(
      `In the code you added, are there any missing tests? please add them. 
      
      ${isPartialCode ? codeToAdd : ""}
  
        Your response should contain the updated code for ${
          isPartialCode ? "code pasted above" : "the entire file"
        } and be in the json format {"code": string}
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
      const fixedCode = fixedCodeJSON.code;
      codeToAdd = fixedCode;
      if (overrideOverwrite) {
        await overrideOverwrite(codeToAdd);
      } else {
        // await overwriteFileContent(filePath, fixedCode);
        replaceAllCodeInFile(filePath, fixedCode);
      }
    }
    i++;
  }

  return codeToAdd;
};

// export async function getTypeScriptErrors(filePath: string) {
//   const tsExtension = vscode.extensions.getExtension(
//     "vscode.typescript-language-features"
//   );
//   if (!tsExtension) {
//     console.error("TypeScript extension not found.");
//     return;
//   }

//   await tsExtension.activate();
//   const api = tsExtension.exports;

//   // Ensure the TypeScript Language Features are available
//   if (!api.getAPI) {
//     console.error(
//       "The required API from TypeScript extension is not available."
//     );
//     return;
//   }

//   const tsApi = api.getAPI(0); // Get API version 0
//   if (!tsApi) {
//     console.error("Failed to get TypeScript API.");
//     return;
//   }

//   const uri = vscode.Uri.file(filePath);
//   const diagnostics = vscode.languages.getDiagnostics(uri);

//   const errors: string[] = [];
//   diagnostics.forEach((diagnostic) => {
//     console.log(
//       `Error at ${diagnostic.range.start.line + 1}:${
//         diagnostic.range.start.character + 1
//       }: ${diagnostic.message}`
//     );
//     errors.push(
//       `Error at ${diagnostic.range.start.line + 1}:${
//         diagnostic.range.start.character + 1
//       }: ${diagnostic.message}`
//     );
//   });

//   return errors;
// }

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

/**
 * Creates a new test file in the same directory as the current file.
 * @param editor The active text editor.
 */
async function createNewTestFile(
  // editor: vscode.TextEditor
  filePath: string,
  autoNewFileName: string
): Promise<string | null> {
  const newFileName = autoNewFileName;
  if (!newFileName) return null;

  // const filePath = editor.document.uri.fsPath;
  const currentFileDir = path.dirname(filePath);
  const newFilePath = path.join(currentFileDir, newFileName);
  fs.writeFileSync(newFilePath, ""); // Create an empty file or handle as needed
  return newFilePath;
}

// /**
//  * Inserts text into a specified file.
//  * @param filePath The file path where the text will be inserted.
//  * @param lineNumber The line number after which the text will be inserted.
//  * @param textToInsert The text to be inserted.
//  */
// async function insertTextToFile(
//   filePath: string,
//   lineNumber: number,
//   textToInsert: string
// ) {
//   const fileUri = vscode.Uri.file(filePath);
//   await insertTextAfterLine(fileUri, lineNumber, textToInsert);
// }
/**
 * Inserts text into a specified file.
 * @param filePath The file path where the text will be inserted.
 * @param lineNumber The line number after which the text will be inserted.
 * @param textToInsert The text to be inserted.
 */
async function insertTextToFile(
  filePath: string,
  lineNumber: number,
  textToInsert: string
) {
  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentLine = 0;
    let fileContent = "";

    for await (const line of rl) {
      fileContent += line + "\n";
      currentLine++;

      if (currentLine === lineNumber) {
        fileContent += textToInsert + "\n";
      }
    }

    rl.close();
    await fs.promises.writeFile(filePath, fileContent, "utf-8");
    console.log(`Text inserted into ${filePath} after line ${lineNumber}`);
  } catch (error) {
    console.error(`Failed to insert text into ${filePath}: ${error}`);
  }
}

export function executeGitCommand(
  command: string,
  workingDirectory: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Git error: ${stderr}`);
        reject(stderr);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Fetches the latest commit SHA from the specified branch.
 *
 * @param branch - The branch to get the latest commit SHA.
 * @param workingDirectory - The local directory of the repository.
 * @returns {Promise<string>} - The commit SHA.
 */
async function getLatestCommitSHA(
  branch: string,
  workingDirectory: string
): Promise<string> {
  const command = `git rev-parse ${branch}`;
  try {
    const commitSHA = await executeGitCommand(command, workingDirectory);
    return commitSHA.trim();
  } catch (error) {
    console.error("Failed to get commit SHA: " + error);
    throw new Error("Failed to get commit SHA: " + error);
  }
}

export const getCurrentBranch = async (
  workingDirectory: string
): Promise<string | null> => {
  try {
    const currentBranch = await executeGitCommand(
      "git rev-parse --abbrev-ref HEAD",
      workingDirectory
    );
    return currentBranch.trim(); // Trim to remove any extraneous newline or space
  } catch (error) {
    console.error("Failed to get current branch: " + error);
    return null; // Return empty string or handle as appropriate for your use case
  }
};

export const writeTestsInExistingFile = async (
  testFile: string
  // lineNumber: number
) => {
  // get code for 1. line number of code to modify and 2. generating test code
  const resp = await getMinimizedTestCodeWithRefToModifyOrContext(
    testFile,
    "existing"
  );
  // console.log({ resp });
  if (!resp) {
    return;
  }

  // if (lineNumber) {
  // generate insertion code for new tests
  const minimizedCodeBlockWithRefToModify = resp.codeBlockWithRefToModify || "";
  // const insertionCode = await generateInsertionCode(
  //   minimizedCodeBlockWithRefToModify,
  //   "existing"
  // );
  const gitDiff2 = selectedCodeWithoutReferences; /* minimizeCode(
    await executeGitCommand(
      // `git diff main -- ${editor?.document.fileName}`,
      `git diff main`,
      workspaceRoot
    )
  );*/
  progressBar.update(50);

  const minimizedByLineCodeToAdd = await generateCodeToInsertIntoExistingFile(
    testFile,
    minimizedCodeBlockWithRefToModify,
    resp.lineNumber || 0,
    fromHighlightedCode ? selectedCodeWithoutReferences : gitDiff2
  );
  let codeToAdd = convertCodeStringBackToCode(minimizedByLineCodeToAdd);
  if (!codeToAdd) {
    throw new Error("no code to add");
  }
  // console.log({ codeToAdd });
  const originalCode = testFile && ts.sys.readFile(testFile);
  if (!originalCode || !testFile) {
    console.error(`Failed to read file: ${testFile}`);
    return null;
  }

  progressBar.update(80);
  replaceAllCodeInFile(testFile, codeToAdd);

  delay(2000);
  // vscode.commands.executeCommand("editor.action.autoFix");

  const newCode = testFile && ts.sys.readFile(testFile);
  if (!newCode || !testFile) {
    console.error(`Failed to read file: ${testFile}`);
    return null;
  }

  progressBar.update(90);

  console.info("Tests inserted successfully into existing file.");
};

const getOutlineOfTestFile = async (testFile: string) => {
  // const minimizedTestFileCode = await minimizeCodeFromFile(testFile);
  const unminimizedTestFileCode = await unminimizeCodeFromFile(testFile);
  const minimizedTestFileCode = minimizeCodeByLines(unminimizedTestFileCode);
  const outlineStr = await sendMessageToChatGPT(
    `give me an outline of the title of each and every single testing block / individual test in this test code (title being the complete line of code that starts the testing block)
    
    ${minimizedTestFileCode}
    
    return it as json format {"testBlock": string}[] where "testBlock" the exact code snippet (entire line of code) i can take a search for to find the line number in the file. your response should ONLY contain json. nothing else. `
  );
  // const outlineStr = await sendMessageToAssistant(
  //   `give me an outline of the title of each testing block in this test code (title being the complete line of code that starts the testing block)

  //   ${minimizedTestFileCode}

  //   return it as json format {"testBlock": string}[] where "testBlock" the exact code snippet (entire line of code) i can take a search for to find the line number in the file. your response should ONLY contain json. nothing else. `
  // );
  // console.log({ outlineStr });
  let outlineJSON: { testBlock: string }[] | null = null;
  try {
    outlineJSON = JSON.parse(
      outlineStr?.replace("```json", "")?.replace("```", "") || ""
    );
  } catch (error) {
    console.error(error);
  }
  // console.log({ outlineJSON });
  return outlineJSON?.map(({ testBlock }) => ({
    testBlock,
    lineNumber: findLineNumber(testFile, testBlock),
  }));

  // return await sendMessageToAssistant(
  //   `give me an outline of the title of each testing block in this test code ${minimizedTestFileCode}. return it as json format {"testBlock": string, "lineNumber": number} where "lineNumber" is the line number above where i can paste new test code within the code block (so i would create a new line below this line number to start writing code)`
  // );
};

export function findLineNumber(
  filePath: string,
  testBlock: string
): number | null {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const lines = fileContent.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(testBlock)) {
      return i + 1;
    }
  }

  return null; // Return null if the test block is not found
}

/**
 * Translates a ts.Node.end value to the line number in the file.
 *
 * @param filePath - The path to the TypeScript file.
 * @param position - The character position (ts.Node.end value).
 * @returns The line number corresponding to the given character position.
 */
function getLineNumberFromPosition(filePath: string, position: number): number {
  const fileContent = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    fileContent,
    ts.ScriptTarget.Latest
  );

  let lineNumber = 1;
  for (let i = 0; i < position; i++) {
    if (fileContent[i] === "\n") {
      lineNumber++;
    }
  }

  return lineNumber;
}

export async function findTestBlockEndLine(
  filePath: string,
  startString: string
): Promise<number | null> {
  // const document = await vscode.workspace.openTextDocument(filePath);
  // const text = document.getText();
  // const ast = parse(text, { loc: true, range: true, jsx: false });

  const asts = await parseCodeForASTs(filePath, startString);
  let astsArray = uniqBy(asts, "ast").filter(({ ast, astObj }) => {
    return !ast.startsWith("SourceFile") && !ast.startsWith("Import");
  });
  // console.log({ startString, asts, astsArray });
  astsArray = astsArray.length
    ? [
        astsArray.find((ast) => {
          return minimizeCode(ast.code).startsWith(minimizeCode(startString));
        }) || astsArray[0],
      ]
    : [];
  if (!astsArray.length) {
    return null;
  }
  const ast = astsArray[0];
  // console.log({
  //   foundtestblockast: ast,
  //   foundlinenumber: getLineNumberFromPosition(filePath, ast.astObj.end),
  // });
  return getLineNumberFromPosition(filePath, ast.astObj.end);
}

const getMinimizedTestCodeWithRefToModifyOrContext = async (
  testFile: string,
  typeOfTestFile: "new" | "existing"
) => {
  const ignoreDiff = fromHighlightedCode;
  const testFileContentsNotMinified = testFile && ts.sys.readFile(testFile);
  if (!testFileContentsNotMinified || !testFile) {
    console.error(`Failed to read file: ${testFile}`);
    return null;
  }

  const gitDiff = currentGitDiff;
  const outline = await getOutlineOfTestFile(testFile);
  // console.log({ outline, gitDiff });
  let prompt = "";

  switch (typeOfTestFile) {
    case "existing":
      prompt = `i want you to pick the most fitting item in this array ${JSON.stringify(
        outline
      )} that relates to the code i've marked as relevant. be as narrow as you can, i would prefer it if you found a specific test block to put this new code in rather than an overarching/umbrella test group. if it makes more sense to create a new test code block/group within the same code i gave you earlier then do that, or if there is code that is very very similar, then add it to that. your response should be the json format {"testBlock": string}. "testBlock" is the "testBlock" string you chose from the array i gave you. your response should be in json format. only json should be in your response. and here are the RELEVANT CHANGES: ${
        ignoreDiff
          ? minimizeCode(selectedCodeWithoutReferences)
          : `
        actual code: ${selectedCodeWithoutReferences}
        ` +
            `
        
        git diff: ${gitDiff}
        `
      }
      
      all i want you to return is the {"testBlock": string} item. again the json format you return should be in the json format {"testBlock": string}`;
      break;

    case "new":
      prompt = `based on this outline ${JSON.stringify(
        outline
      )}, choose a sample testing group code block WITHIN THE TEST CODE I GAVE YOU EARLIER i can use to create tests in a new file. your response should be the json format {"startString": string, "lineNumber": number}. your response should be in json format. only json should be in your response. "startString" is where the code block to put the tests in starts and "endString" is where the code block ends. The "startString" and "endString" that are parts of the code i need to place the new code in between and they should be easily found with a simple typescript function, they should be the starting strings, not closures.`;
      break;

    default:
      throw new Error("Something went wrong");
      break;
  }

  await sendMessageToAssistant(
    `here is the test file for you to use as context. await further instructions: ${minimizeCode(
      await unminimizeCodeFromFile(testFile)
    )}`,
    "gpt-4o"
  );

  const jsonPositionToModifyStr = (await sendMessageToAssistant(prompt))
    ?.message;
  let jsonPositionToModify: {
    startString?: string;
    testBlock?: string;
    lineNumber?: number;
  } | null = null;
  try {
    jsonPositionToModify = JSON.parse(
      // jsonPositionToModifyStr?.message
      jsonPositionToModifyStr?.replace("```json", "")?.replace("```", "") || ""
    );
    // console.log({ jsonPositionToModify });
    if (jsonPositionToModify) {
      jsonPositionToModify.lineNumber =
        (await findTestBlockEndLine(
          testFile,
          jsonPositionToModify?.testBlock ||
            jsonPositionToModify?.startString ||
            ""
        )) ||
        jsonPositionToModify.lineNumber ||
        -1;
    }
  } catch (error) {
    console.error(error);
  }

  // console.log({ startEndStringJSON: jsonPositionToModify });
  const codeBlockToModifyResp =
    (jsonPositionToModify &&
      (await findCodeBlock(testFile, {
        startString:
          jsonPositionToModify.startString ||
          jsonPositionToModify.testBlock ||
          "",
        lineNumber: jsonPositionToModify.lineNumber || 0,
      }))) ||
    null;
  if (!codeBlockToModifyResp) {
    console.log("couldn't find the code to modify", {
      jsonPositionToModifyStr,
      // initialContextMsg,
      outline,
      jsonPositionToModify,
    });
    return null;
  }
  const codeBlockToModify = codeBlockToModifyResp?.code || "";
  const codeBlockWithRefToModify =
    codeBlockToModify &&
    (await extractCodeAndReferences([testFile], [codeBlockToModify], 3));
  return {
    codeBlockWithRefToModify,
    astObj: codeBlockToModifyResp.astObj,
    startString: jsonPositionToModify?.startString,
    lineNumber: jsonPositionToModify?.lineNumber,
  };
};

const getLineNumber = (node: ts.Node, sourceFile: ts.SourceFile): number => {
  const { line } = ts.getLineAndCharacterOfPosition(
    sourceFile,
    node.getStart()
  );
  return line + 1; // TypeScript returns 0-based line number, add 1 for 1-based line number
};

async function generateInsertionCode(
  codeBlockWithRefToModify: string, // only needed for writing tests to existing file
  typeOfTestFile: "existing" | "new",
  newTestFileName?: string // only needed if type of test file is new
): Promise<string> {
  const ignoreDiff = fromHighlightedCode;

  // console.log({ currentGitDiff });
  const gitDiff = currentGitDiff;

  // console.log({ fromHighlightedCode, selectedCodeWithoutReferences, gitDiff });

  let planningPrompt = "";
  let prompt = "";
  switch (typeOfTestFile) {
    case "existing":
      planningPrompt = `ok based on this, you are a planner that lays out a plan for the software developer to read and write tests from. a very important job because you only want to add USEFUL tests, not just adding tests to add them but actually testing potential issues with the changed code referenced below. please write a item by item plan which specifically makes tests for the code and git diff here: ${
        ignoreDiff
          ? minimizeCode(selectedCodeWithoutReferences || "")
          : `
        actual code: ${selectedCodeWithoutReferences}
        ` +
            `
        the tests should specifically checking for the changes within the diff here 
        git diff: ${gitDiff}

        `
      }${UNIT_TEST_BEST_PRACTICES}, please break down a list of each unit test i could add in this part of the code in my test code. each item in this list should be a new added test. please remember clearly the context of all of the code in this whole conversation and make sure these will work in the existing test file`;
      prompt = `ok based on this and the code below AND the tests you just spoke about adding, please write new tests in this part of the code in my test code with only the code for the new tests included and make it code complete so i can run tests immediately. please remember clearly the context of all of the code in this whole conversation but specifically the referenced code and what fields are required and/or optional inside of this part of the code ${
        ignoreDiff
          ? minimizeCode(selectedCodeWithoutReferences || "")
          : `
        actual code: ${selectedCodeWithoutReferences}
        ` +
            `
        
        git diff: ${gitDiff}

        `
      }${UNIT_TEST_BEST_PRACTICES}. it is very important that the code you respond with is only the added code so i can paste it in the middle of the file somwhere. so nothing like imports should be added. Your response should only contain code in this exact JSON FORMAT {"code": string} ${codeBlockWithRefToModify}`;
      break;
    case "new":
      if (!newTestFileName) {
        throw new Error("Need new test file name in generateInsertionCode");
      }
      planningPrompt = `ok based on this and the code below, please break down a list of the most useful tests that are BRAND NEW TESTS that will be in a BRAND NEW FILE called ${newTestFileName}. please remember clearly the context of all of the code in this whole conversation. the tests should clearly be for this highlighted code: ${minimizeCode(
        ignoreDiff
          ? minimizeCode(selectedCodeWithoutReferences || "")
          : `
        actual code: ${selectedCodeWithoutReferences}
        ` +
              `
        
        git diff: ${gitDiff}
        `
      )}`;
      prompt = `ok based on this and the code below AND the tests you just spoke about adding, please write BRAND NEW TESTS in a BRAND NEW FILE called ${newTestFileName} based on this relevant code ${
        ignoreDiff
          ? minimizeCode(selectedCodeWithoutReferences || "")
          : `code: ${minimizeCode(
              selectedCodeWithoutReferences || ""
            )} with the gitdiff: ${gitDiff}`
      }. please remember clearly the context of all of the code in this whole conversation but make the tests specifically for this highlighted code: ${minimizeCode(
        selectedCodeWithoutReferences || ""
      )}. fill in the test code completely so i can run tests immediately. Your response should only contain code in this exact JSON FORMAT {"code": string}`;
      break;

    default:
      throw new Error("something went wrong");
      break;
  }
  // console.log("planningPrompt");
  // console.log(planningPrompt);
  const plan = await sendMessageToAssistant(planningPrompt, "gpt-4o");
  // console.log({ planningPrompt, plan, selectedCodeWithoutReferences });

  const codeToAddJSONStr = await sendMessageToAssistant(
    prompt,
    "gpt-4o",
    `Try to use existing routes or other related existing code as much as you can rather than making things up that don't exist. Your response should only contain code in the json format {"code": string}`
  );
  let codeToAddJSON: { code: string } | null = null;
  try {
    codeToAddJSON = JSON.parse(
      codeToAddJSONStr?.message?.replace(/```json/g, "").replace(/```/g, "") ||
        ""
    );
  } catch (error) {
    console.error(error);
  }
  return codeToAddJSON?.code || "";
}

/**
 * Inserts text into a file after a specified line.
 * @param uri The URI of the file to edit.
 * @param lineNumber The line number after which the text will be inserted.
 * @param textToInsert The text to be inserted.
 */
// async function insertTextAfterLine(
//   uri: vscode.Uri,
//   lineNumber: number,
//   textToInsert: string
// ): Promise<void> {
//   let document = await vscode.workspace.openTextDocument(uri); // Open the document
//   let editor = await vscode.window.showTextDocument(document); // Show the document in an editor

//   // Determine the line number to insert the text
//   let lineToInsert = lineNumber;
//   if (lineToInsert >= document.lineCount) {
//     // If the specified line number is beyond the current number of lines, use the last line
//     lineToInsert = document.lineCount - 1;
//   }

//   // Find the position to insert the text. The text is added at the beginning of the line after 'lineToInsert'.
//   // const position = new vscode.Position(lineToInsert + 1, 0);
//   const position = new vscode.Position(lineToInsert, 0);

//   await editor.edit((editBuilder) => {
//     editBuilder.insert(position, textToInsert + "\n"); // Insert the text at the position
//   });
// }

/**
 * Inserts text into a file after a specified line.
 * @param filePath The path of the file to edit.
 * @param lineNumber The line number after which the text will be inserted.
 * @param textToInsert The text to be inserted.
 */
async function insertTextAfterLine(
  filePath: string,
  lineNumber: number,
  textToInsert: string
): Promise<void> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentLine = 0;
  let fileContent = "";

  for await (const line of rl) {
    fileContent += line + "\n";
    currentLine++;

    if (currentLine === lineNumber) {
      fileContent += textToInsert + "\n";
    }
  }

  rl.close();

  if (currentLine < lineNumber) {
    // If the specified line number is beyond the current number of lines, append the text at the end
    fileContent += textToInsert + "\n";
  }

  fs.writeFileSync(filePath, fileContent, "utf-8");
}

export const UNIT_TEST_BEST_PRACTICES = `
here is a list of best practices for writing useful unit tests:

    Focus on Business Logic
        Prioritize testing core business logic over trivial code

    Single Responsibility
        Each test should focus on one specific behavior or scenario

    Use Descriptive Test Names
        Names should clearly describe what is being tested and the expected outcome

    Mock Dependencies Appropriately
        Isolate the unit of work by mocking external dependencies

    Write Positive and Negative Cases
        Include tests for typical use cases as well as edge cases and error handling

    Cover Boundary Conditions
        Ensure tests cover the limits and boundaries of inputs and outputs

    Ensure Meaningful Assertions
        Assertions should be relevant and meaningful to the test scenario

    Avoid Over-Mocking
        Do not excessively mock, which can lead to brittle tests

    Test Behavior, Not Implementation
        Focus on testing the behavior rather than implementation details

    Maintain Test Readability and Maintainability
        Write clean, readable tests that are easy to maintain

    Use TDD or BDD Practices
        Follow Test-Driven Development or Behavior-Driven Development for better test coverage

    Optimize Test Performance
        Ensure tests run quickly to maintain a fast feedback loop

    Refactor Tests Regularly
        Regularly review and refactor tests to remove duplication and improve clarity

    Integrate Tests into CI/CD
        Ensure tests are integrated into your Continuous Integration/Continuous Deployment pipeline

    Generate Test Reports
        Use tools to generate and review test coverage reports

    Document Complex Tests
        Provide comments or documentation for complex test scenarios

Use these best practices to guide the AI model in generating useful and effective unit tests based on your git diff and code snippets.`;

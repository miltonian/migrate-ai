import * as fs from "fs";
import * as readline from "readline";
import {
  currentGitDiff,
  fromHighlightedCode,
  selectedCodeWithoutReferences,
} from "./index";
import { sendMessageToAssistant } from "./openai-utils";
import {
  UNIT_TEST_BEST_PRACTICES,
  convertCodeStringBackToCode,
  minimizeCode,
  minimizeCodeByLines,
  unminimizeCodeFromFile,
} from "./utils";
import ts = require("typescript");

export const getRelevantStartStringToReplace = async (
  testFile: string,
  prompt: string
) => {
  const testFileContentsNotMinified = await unminimizeCodeFromFile(testFile);
  const jsonPositionToModifyStr = await sendMessageToAssistant(
    `${prompt}
      
      where should the new tests go WITHIN THE TEST CODE HERE: ${minimizeCodeByLines(
        testFileContentsNotMinified
      )}
        your response should be the json format {"startString": string, "endString": string}. your response should be in json format. only json should be in your response. "startString" is where the code block to put the tests in startsa and i can take a search for to find the line number in the file.`,
    "gpt-4o",
    'your response should be the json format {"startString": string, "endString": string}. your response should be in json format. only json should be in your response. "startString" is where the EXACT CODE SNIPPET i can take a search for to find the line number in the file. only json should be in your response without any new lines or anything that would make it hard to parse the json.'
  );
  let jsonPositionToModify: {
    startString: string;
    endString: string;
  } | null = null;
  try {
    jsonPositionToModify = JSON.parse(
      jsonPositionToModifyStr?.message
        ?.replace(/```json/g, "")
        .replace(/```/g, "") || ""
    );
  } catch (error: any) {
    console.error(error);
    throw new Error(error);
  }

  //   console.log({ startEndStringJSON: jsonPositionToModify });

  return {
    startString: convertCodeStringBackToCode(
      jsonPositionToModify?.startString || ""
    ),
  };
};

export async function generateCodeToInsertIntoExistingFile(
  testFile: string,
  minimizedCodeBlockWithRefToModify: string,
  lineNumberToAddCode: number,
  gitDiffOrHighlightedCode: string
): Promise<{
  modifiedCode: string;
  fullFileCode: string;
}> {
  const ignoreDiff = fromHighlightedCode;

  // const scopeToPlaceCode = minimizeCodeByLines(scopeToPlaceCodeUnminimized);
  const planningPrompt = `ok based on this, please specifically make tests for the code here: ${gitDiffOrHighlightedCode}, 
        please break down a list of each unit test i could add in this part of the code in my test code. 
        please be smart and frugal in your judgement for how many tests to add in context with the other tests. i only want to add value to the code coverage without duplicating code coverage. 
        each item in this list should be a new added test that doesnt already exist. 
        please remember clearly the context of all of the code in this whole conversation.
        BUT only make the tests about this git diff and code: 
        
        ${
          ignoreDiff
            ? minimizeCode(selectedCodeWithoutReferences || "")
            : `
        actual code: ${selectedCodeWithoutReferences}
        ` +
              `
        
        git diff: ${currentGitDiff}

        `
        }${UNIT_TEST_BEST_PRACTICES}`;

  // const unminimizedTestFileCode = await unminimizeCodeFromFile(testFile);
  // const fileCodeWithLineBreaks = minimizeCodeByLines(unminimizedTestFileCode)

  // GENERATE PLAN
  const _ = await sendMessageToAssistant(planningPrompt, "gpt-4o");

  const prompt = `ok based on the plan just created and the code below AND the tests you just spoke about adding, please write the new tests without any of the existing code included in your response although you are aware of the code that you are placing this code in between. and make it code complete so i can run tests immediately. please remember clearly the context of all of the code in this whole conversation but specifically the referenced code and what fields are required and/or optional inside of this part of the code ${gitDiffOrHighlightedCode}. 
        it is very important that the code you respond with is written in a way that should only be net new because the rest of the code in this file should stay the same. the code needs to be written in a way that perfectly fits into place with the rest of the code in this file without causing any new errors and without writing any duplicate code that already exists in this file. 
        this is where i want to place the new tests: ${minimizedCodeBlockWithRefToModify}. please only respond with the new tests, leave the existing code alone and don't include existing code in your response.
        
        your response is text, not json. only return the code i can paste in my file. nothing else `;

  const codeToAddJSONStr = await sendMessageToAssistant(
    prompt,
    "gpt-4o",
    `
      Try to use existing routes or other related existing code as much as you can rather than making things up that don't exist. Your response should only contain the code to add. your response is text, not json. only return the code i can paste in my file. nothing else
      `
  );
  //   console.log({ codeToAddJSONStr });

  const newCode =
    codeToAddJSONStr?.message
      .replace("```typescript", "")
      .replace("```javascript", "")
      .replace("```", "") || "";

  //   console.log({ newCode });
  const fullFileCode = await getModifiedFileContent(
    testFile,
    lineNumberToAddCode,
    convertCodeStringBackToCode(newCode)
  );
  // const fullFileCodeMinimized = minimizeCodeByLines(
  //   unminimizedTestFileCode
  // ).replace(scopeToPlaceCode, newCode);
  //   console.log({ fullFileCode });
  return {
    modifiedCode: convertCodeStringBackToCode(newCode),
    fullFileCode,
  };
}

/**
 * Extracts import statements from the given TypeScript code and returns
 * the remaining code and the extracted imports as separate strings.
 *
 * @param {string} code - The TypeScript code to process.
 * @returns {{ imports: string; remainingCode: string }} An object containing the imports and the remaining code.
 *
 * @example
 * const result = extractImports(`import { x } from 'x';\nconst y = 1;`);
 * console.log(result.imports); // "import { x } from 'x';"
 * console.log(result.remainingCode); // "const y = 1;"
 */
export function extractImports(code: string): {
  imports: string;
  remainingCode: string;
} {
  // Create a source file
  const sourceFile = ts.createSourceFile(
    "tempFile.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  let imports = "";
  let remainingCode = code;

  // Visit each node in the source file
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      // Extract the import statement text
      const importText = node.getFullText(sourceFile);
      imports += importText;
      // Remove the import statement from the remaining code and preserve line numbers
      const start = node.getFullStart();
      const end = node.getEnd();
      const lines = importText.split("\n").length;
      remainingCode =
        remainingCode.slice(0, start) +
        "\n".repeat(lines - 1) +
        remainingCode.slice(end);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return { imports: imports.trim(), remainingCode: remainingCode.trim() };
}

export async function insertCodeIntoExistingCode(
  testFile: string,
  //   scopeToPlaceCodeUnminimized: string,
  // gitDiffOrHighlightedCode: string
  promptForNewCodeGeneration: string
): Promise<string> {
  const startStringResp = await getRelevantStartStringToReplace(
    testFile,
    promptForNewCodeGeneration
  );
  const startString = startStringResp.startString || "";
  const scopeToPlaceCode = minimizeCodeByLines(startString);

  const unminimizedTestFileCode = await unminimizeCodeFromFile(testFile);
  // const fileCodeWithLineBreaks = minimizeCodeByLines(unminimizedTestFileCode)

  const addToPrompt = `please remember clearly the context of all of the code in this whole conversation. 
        it is very important that the code you respond with is written in a way that should completely replace the code below. the code needs to be written in a way that completely replaces the original code and can be replaced without causing any new errors and without missing any existing tests. 
        please start here and add the new code: ${scopeToPlaceCode}
        it should be written in a way that i can replace this string in the code ${scopeToPlaceCode} with the new code you provide me. so the code you provide me should itself begin with ${scopeToPlaceCode}
        Your response should be the code that is written in such a waythat i can essentially replace the string ${scopeToPlaceCode} with your code and have the code work properly. your response is text, not json. only return the code i can paste in my file. nothing else.`;

  const codeToAddJSONStr = await sendMessageToAssistant(
    `${promptForNewCodeGeneration}
    
    ${addToPrompt}`,
    "gpt-4o",
    `
      Try to use existing routes or other related existing code as much as you can rather than making things up that don't exist. Your response should only contain the code to add. your response is text, not json. only return the code i can paste in my file. nothing else. LASTLY this is important, write this code so that only these new tests you've added will run (e.g. using code like describe.only, it.only, etc)
    `
  );
  //   console.log({ codeToAddJSONStr });

  const newCode =
    codeToAddJSONStr?.message
      .replace("```typescript", "")
      .replace("```javascript", "")
      .replace("```", "") || "";
  //   console.log({ newCode });
  const fullFileCodeMinimized = minimizeCodeByLines(
    unminimizedTestFileCode
  ).replace(scopeToPlaceCode, newCode);
  //   console.log({ fullFileCodeMinimized });
  return convertCodeStringBackToCode(fullFileCodeMinimized);
}

/**
 * Inserts code into the content of a file at a specified line number and returns the modified content as a string.
 *
 * @param filePath - The path to the file.
 * @param lineNumber - The line number before which the code should be inserted.
 * @param codeToInsert - The code to be inserted.
 * @returns - The modified content of the file as a string.
 */
export async function getModifiedFileContent(
  filePath: string,
  lineNumber: number,
  codeToInsert: string
): Promise<string> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentLine = 0;
  let fileContent = "";

  for await (const line of rl) {
    if (currentLine === lineNumber - 1) {
      fileContent += codeToInsert + "\n";
    }
    fileContent += line + "\n";
    currentLine++;
  }

  rl.close();
  return fileContent;
}

/**
 * Extracts the code between two line numbers from a given file.
 *
 * @param filePath - The path to the file.
 * @param startLine - The starting line number (inclusive).
 * @param endLine - The ending line number (inclusive).
 * @returns The extracted code as a string.
 */
async function extractCodeBetweenLines(
  filePath: string,
  startLine: number,
  endLine: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentLine = 0;
    let extractedCode = "";

    rl.on("line", (line) => {
      currentLine++;

      if (currentLine >= startLine && currentLine <= endLine) {
        extractedCode += line + "\n";
      }

      if (currentLine > endLine) {
        rl.close();
      }
    });

    rl.on("close", () => {
      resolve(extractedCode);
    });

    rl.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Replaces the code between two line numbers in a given file.
 *
 * @param filePath - The path to the file.
 * @param startLine - The starting line number (inclusive).
 * @param endLine - The ending line number (inclusive).
 * @param newCode - The new code to replace the specified lines with.
 * @returns A promise that resolves when the file has been successfully updated.
 */
export async function replaceCodeBetweenLines(
  filePath: string,
  startLine: number,
  endLine: number,
  newCode: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentLine = 0;
    let fileContent = "";
    let newContent = "";

    rl.on("line", (line) => {
      currentLine++;

      if (currentLine < startLine || currentLine > endLine) {
        fileContent += line + "\n";
      }

      if (currentLine === startLine) {
        fileContent += newCode + "\n";
      }
    });

    rl.on("close", () => {
      // Create new content with the replaced code
      newContent = fileContent;

      // Write the new content back to the file
      fs.writeFile(filePath, newContent, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    rl.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Replaces all code in a given file with the provided new code.
 *
 * @param filePath - The path to the file to be modified.
 * @param newCode - The new code to replace the existing content in the file.
 */
export const replaceAllCodeInFile = (
  filePath: string,
  newCode: string
): void => {
  //   console.log({ filePath });
  try {
    // Ensure the file exists before attempting to read it
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Write the new code to the file, replacing the existing content
    fs.writeFileSync(filePath, newCode, "utf8");
    console.log(`File content replaced successfully: ${filePath}`);
  } catch (error: any) {
    console.error(`Error replacing file content: ${error.message}`);
  }
};

/**
 * Inserts code into a file at a specified line number.
 *
 * @param filePath - The path to the file.
 * @param lineNumber - The line number after which the code should be inserted.
 * @param codeToInsert - The code to be inserted.
 */
async function insertCodeAtLine(
  filePath: string,
  lineNumber: number,
  codeToInsert: string
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
      fileContent += codeToInsert + "\n";
    }
  }

  rl.close();

  fs.writeFileSync(filePath, fileContent, "utf-8");
}

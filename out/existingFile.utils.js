"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceAllCodeInFile = exports.replaceCodeBetweenLines = exports.insertCodeIntoExistingCode = exports.generateCodeToInsertIntoExistingFile = exports.getRelevantStartStringToReplace = void 0;
const fs = __importStar(require("fs"));
const readline_1 = __importDefault(require("readline"));
const index_1 = require("./index");
const openai_utils_1 = require("./openai-utils");
const utils_1 = require("./utils");
const getRelevantStartStringToReplace = async (testFile, prompt) => {
    const testFileContentsNotMinified = await (0, utils_1.unminimizeCodeFromFile)(testFile);
    const jsonPositionToModifyStr = await (0, openai_utils_1.sendMessageToAssistant)(`${prompt}
      
      where should the new tests go WITHIN THE TEST CODE HERE: ${(0, utils_1.minimizeCodeByLines)(testFileContentsNotMinified)}
        your response should be the json format {"startString": string, "endString": string}. your response should be in json format. only json should be in your response. "startString" is where the code block to put the tests in startsa and i can take a search for to find the line number in the file.`, "gpt-4o", 'your response should be the json format {"startString": string, "endString": string}. your response should be in json format. only json should be in your response. "startString" is where the EXACT CODE SNIPPET i can take a search for to find the line number in the file. only json should be in your response without any new lines or anything that would make it hard to parse the json.');
    let jsonPositionToModify = null;
    try {
        jsonPositionToModify = JSON.parse(jsonPositionToModifyStr?.message
            ?.replace(/```json/g, "")
            .replace(/```/g, "") || "");
    }
    catch (error) {
        console.error(error);
        throw new Error(error);
    }
    console.log({ startEndStringJSON: jsonPositionToModify });
    return {
        startString: (0, utils_1.convertCodeStringBackToCode)(jsonPositionToModify?.startString || ""),
    };
};
exports.getRelevantStartStringToReplace = getRelevantStartStringToReplace;
async function generateCodeToInsertIntoExistingFile(testFile, minimizedCodeBlockWithRefToModify, lineNumberToAddCode, gitDiffOrHighlightedCode) {
    const ignoreDiff = index_1.fromHighlightedCode;
    // const scopeToPlaceCode = minimizeCodeByLines(scopeToPlaceCodeUnminimized);
    const planningPrompt = `ok based on this, please specifically make tests for the code here: ${gitDiffOrHighlightedCode}, 
        please break down a list of each unit test i could add in this part of the code in my test code. 
        please be smart and frugal in your judgement for how many tests to add in context with the other tests. i only want to add value to the code coverage without duplicating code coverage. 
        each item in this list should be a new added test that doesnt already exist. 
        please remember clearly the context of all of the code in this whole conversation.
        BUT only make the tests about this git diff and code: 
        
        ${ignoreDiff
        ? (0, utils_1.minimizeCode)(index_1.selectedCodeWithoutReferences || "")
        : `
        actual code: ${index_1.selectedCodeWithoutReferences}
        ` +
            `
        
        git diff: ${index_1.currentGitDiff}

        `}${utils_1.UNIT_TEST_BEST_PRACTICES}`;
    // const unminimizedTestFileCode = await unminimizeCodeFromFile(testFile);
    // const fileCodeWithLineBreaks = minimizeCodeByLines(unminimizedTestFileCode)
    // GENERATE PLAN
    const _ = await (0, openai_utils_1.sendMessageToAssistant)(planningPrompt, "gpt-4o");
    const prompt = `ok based on the plan just created and the code below AND the tests you just spoke about adding, please write the new tests without any of the existing code included in your response although you are aware of the code that you are placing this code in between. and make it code complete so i can run tests immediately. please remember clearly the context of all of the code in this whole conversation but specifically the referenced code and what fields are required and/or optional inside of this part of the code ${gitDiffOrHighlightedCode}. 
        it is very important that the code you respond with is written in a way that should only be net new because the rest of the code in this file should stay the same. the code needs to be written in a way that perfectly fits into place with the rest of the code in this file without causing any new errors and without writing any duplicate code that already exists in this file. 
        this is where i want to place the new tests: ${minimizedCodeBlockWithRefToModify}. please only respond with the new tests, leave the existing code alone and don't include existing code in your response.
        
        your response is text, not json. only return the code i can paste in my file. nothing else `;
    const codeToAddJSONStr = await (0, openai_utils_1.sendMessageToAssistant)(prompt, "gpt-4o", `
      Try to use existing routes or other related existing code as much as you can rather than making things up that don't exist. Your response should only contain the code to add. your response is text, not json. only return the code i can paste in my file. nothing else
      `);
    console.log({ codeToAddJSONStr });
    const newCode = codeToAddJSONStr?.message
        .replace("```typescript", "")
        .replace("```javascript", "")
        .replace("```", "") || "";
    console.log({ newCode });
    const fullFileCode = await getModifiedFileContent(testFile, lineNumberToAddCode, (0, utils_1.convertCodeStringBackToCode)(newCode));
    // const fullFileCodeMinimized = minimizeCodeByLines(
    //   unminimizedTestFileCode
    // ).replace(scopeToPlaceCode, newCode);
    console.log({ fullFileCode });
    return fullFileCode;
}
exports.generateCodeToInsertIntoExistingFile = generateCodeToInsertIntoExistingFile;
async function insertCodeIntoExistingCode(testFile, 
//   scopeToPlaceCodeUnminimized: string,
// gitDiffOrHighlightedCode: string
promptForNewCodeGeneration) {
    const startStringResp = await (0, exports.getRelevantStartStringToReplace)(testFile, promptForNewCodeGeneration);
    const startString = startStringResp.startString || "";
    const scopeToPlaceCode = (0, utils_1.minimizeCodeByLines)(startString);
    const unminimizedTestFileCode = await (0, utils_1.unminimizeCodeFromFile)(testFile);
    // const fileCodeWithLineBreaks = minimizeCodeByLines(unminimizedTestFileCode)
    const addToPrompt = `please remember clearly the context of all of the code in this whole conversation. 
        it is very important that the code you respond with is written in a way that should completely replace the code below. the code needs to be written in a way that completely replaces the original code and can be replaced without causing any new errors and without missing any existing tests. 
        please start here and add the new code: ${scopeToPlaceCode}
        it should be written in a way that i can replace this string in the code ${scopeToPlaceCode} with the new code you provide me. so the code you provide me should itself begin with ${scopeToPlaceCode}
        Your response should be the code that is written in such a waythat i can essentially replace the string ${scopeToPlaceCode} with your code and have the code work properly. your response is text, not json. only return the code i can paste in my file. nothing else `;
    const codeToAddJSONStr = await (0, openai_utils_1.sendMessageToAssistant)(`${promptForNewCodeGeneration}
    
    ${addToPrompt}`, "gpt-4o", `
      Try to use existing routes or other related existing code as much as you can rather than making things up that don't exist. Your response should only contain the code to add. your response is text, not json. only return the code i can paste in my file. nothing else
    `);
    console.log({ codeToAddJSONStr });
    const newCode = codeToAddJSONStr?.message
        .replace("```typescript", "")
        .replace("```javascript", "")
        .replace("```", "") || "";
    console.log({ newCode });
    const fullFileCodeMinimized = (0, utils_1.minimizeCodeByLines)(unminimizedTestFileCode).replace(scopeToPlaceCode, newCode);
    console.log({ fullFileCodeMinimized });
    return (0, utils_1.convertCodeStringBackToCode)(fullFileCodeMinimized);
}
exports.insertCodeIntoExistingCode = insertCodeIntoExistingCode;
/**
 * Inserts code into the content of a file at a specified line number and returns the modified content as a string.
 *
 * @param filePath - The path to the file.
 * @param lineNumber - The line number before which the code should be inserted.
 * @param codeToInsert - The code to be inserted.
 * @returns - The modified content of the file as a string.
 */
async function getModifiedFileContent(filePath, lineNumber, codeToInsert) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline_1.default.createInterface({
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
async function extractCodeBetweenLines(filePath, startLine, endLine) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline_1.default.createInterface({
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
async function replaceCodeBetweenLines(filePath, startLine, endLine, newCode) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline_1.default.createInterface({
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
                }
                else {
                    resolve();
                }
            });
        });
        rl.on("error", (err) => {
            reject(err);
        });
    });
}
exports.replaceCodeBetweenLines = replaceCodeBetweenLines;
/**
 * Replaces all code in a given file with the provided new code.
 *
 * @param filePath - The path to the file to be modified.
 * @param newCode - The new code to replace the existing content in the file.
 */
const replaceAllCodeInFile = (filePath, newCode) => {
    console.log({ filePath });
    try {
        // Ensure the file exists before attempting to read it
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        // Write the new code to the file, replacing the existing content
        fs.writeFileSync(filePath, newCode, "utf8");
        console.log(`File content replaced successfully: ${filePath}`);
    }
    catch (error) {
        console.error(`Error replacing file content: ${error.message}`);
    }
};
exports.replaceAllCodeInFile = replaceAllCodeInFile;
/**
 * Inserts code into a file at a specified line number.
 *
 * @param filePath - The path to the file.
 * @param lineNumber - The line number after which the code should be inserted.
 * @param codeToInsert - The code to be inserted.
 */
async function insertCodeAtLine(filePath, lineNumber, codeToInsert) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline_1.default.createInterface({
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
//# sourceMappingURL=existingFile.utils.js.map
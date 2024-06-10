import * as fs from "fs";

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

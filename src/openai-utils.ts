import fs from "fs";
import OpenAI from "openai";

import path from "path";
import { selectedCodeWithoutReferences } from "./index";
import { TOKEN_MAX_LENGTH, delay, minimizeCode } from "./utils";

// const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

// const THREAD_FILE_PATH = vscode.Uri.file(
//   path.join(workspaceRoot || "", ".celp-ai/.cache/thread_id")
// );
// const ASSISTANT_FILE_PATH = vscode.Uri.file(
//   path.join(workspaceRoot || "", ".celp-ai/.cache/assistant_id")
// );
// const EMBEDDINGS_FILE_PATH = vscode.Uri.file(
//   path.join(workspaceRoot || "", ".celp-ai/.cache/embeddings_output.json")
// );
// Get the current working directory
const workspaceRoot = process.cwd();

// Construct the file paths
const THREAD_FILE_PATH = path.join(workspaceRoot, ".celp-ai/.cache/thread_id");
const ASSISTANT_FILE_PATH = path.join(
  workspaceRoot,
  ".celp-ai/.cache/assistant_id"
);
const EMBEDDINGS_FILE_PATH = path.join(
  workspaceRoot,
  ".celp-ai/.cache/embeddings_output.json"
);

let openai: OpenAI | null = null;

export const initializeClient = async (apiKey: string) => {
  if (apiKey) {
    openai = new OpenAI({ apiKey });
  } else {
    throw new Error("Failed to initiate OpenAI Client");
  }
  return openai;
};

// export const getApiKey = (): string => {
//   // Retrieve the configuration object for your extension
//   const config = vscode.workspace.getConfiguration();
//   // Get the API key from the configuration, defaulting to an empty string if not set
//   const apiKey = config.get<string>("openai.apiKey", "");

//   return apiKey;
// };

// export const getThreadIdFromFile = async (): Promise<string | null> => {
//   try {
//     const data = new TextDecoder().decode(
//       await vscode.workspace.fs.readFile(THREAD_FILE_PATH)
//     );
//     return data;
//   } catch (err) {
//     return null;
//   }
// };

/**
 * Reads the thread ID from a file.
 * @param filePath The path to the file containing the thread ID.
 * @returns A promise that resolves to the thread ID as a string or null if an error occurs.
 */
export const getThreadIdFromFile = async (): Promise<string | null> => {
  try {
    const data = new TextDecoder().decode(
      await fs.promises.readFile(THREAD_FILE_PATH)
    );
    return data;
  } catch (err) {
    return null;
  }
};

// export const saveThreadIdToFile = async (threadId: string) => {
//   try {
//     await vscode.workspace.fs.writeFile(
//       THREAD_FILE_PATH,
//       new TextEncoder().encode(threadId)
//     );
//     console.log("File has been saved.");
//   } catch (err) {
//     console.error("Error writing file:", err);
//   }
// };
/**
 * Saves the thread ID to a file.
 * @param threadId The thread ID to save.
 * @param filePath The path to the file where the thread ID will be saved.
 */
export const saveThreadIdToFile = async (threadId: string) => {
  try {
    await fs.promises.writeFile(
      THREAD_FILE_PATH,
      new TextEncoder().encode(threadId)
    );
    // console.log("File has been saved.");
  } catch (err) {
    console.error("Error writing file:", err);
  }
};

// export const deleteThreadIdFile = async () => {
//   try {
//     await vscode.workspace.fs.delete(THREAD_FILE_PATH, {
//       recursive: false,
//       useTrash: true,
//     });
//     console.log("File has been deleted.");
//   } catch (err) {
//     console.error("Error deleting file:", err);
//   }
// };
/**
 * Deletes the thread ID file.
 * @param filePath The path to the file to be deleted.
 */
export const deleteThreadIdFile = async () => {
  try {
    await fs.promises.unlink(THREAD_FILE_PATH);
    // console.log("File has been deleted.");
  } catch (err) {
    console.error("Error deleting file:", err);
  }
};

// export const getAssistantIdFromFile = async () => {
//   try {
//     const data = new TextDecoder().decode(await vscode.workspace.fs.readFile(ASSISTANT_FILE_PATH));
//     return data;
//   } catch (err) {
//     return null;
//   }
// };
// export const saveAssistantIdToFile = async (assistantId: string) => {
//   try {
//     await vscode.workspace.fs.writeFile(ASSISTANT_FILE_PATH, (new TextEncoder().encode(assistantId)));
//     console.log("File has been saved.");
//   } catch (err) {
//     console.error("Error writing file:", err);
//   }
// };
// export const getAssistantIdFromFile = async (
//   identifiableCode: string
// ): Promise<string | null> => {
//   try {
//     const fileContent = new TextDecoder().decode(
//       await vscode.workspace.fs.readFile(ASSISTANT_FILE_PATH)
//     );
//     const assistants = JSON.parse(fileContent) || [];
//     const minimizedCode = minimizeCode(identifiableCode)
//       .replace(/[^\w]/g, "")
//       .slice(0, TOKEN_MAX_LENGTH);
//     const assistant = assistants.find(
//       (asst: any) => asst.metadata.identifiableCode === minimizedCode
//     );
//     if (assistant) {
//       return assistant.assistantId;
//     }
//     console.log(
//       "No matching assistant found for the provided identifiable code."
//     );
//     return null;
//   } catch (err) {
//     console.error("Error reading file:", err);
//     return null;
//   }
// };
/**
 * Reads the assistant ID from the assistant file based on the identifiable code.
 * @param identifiableCode The identifiable code to find the assistant ID.
 * @param filePath The path to the assistant file.
 * @returns A promise that resolves to the assistant ID or null if not found.
 */
export const getAssistantIdFromFile = async (
  identifiableCode: string
): Promise<string | null> => {
  try {
    const fileContent = await fs.promises.readFile(ASSISTANT_FILE_PATH, "utf8");
    const assistants = JSON.parse(fileContent) || [];
    const minimizedCode = minimizeCode(identifiableCode)
      .replace(/[^\w]/g, "")
      .slice(0, TOKEN_MAX_LENGTH);
    const assistant = assistants.find(
      (asst: any) => asst.metadata.identifiableCode === minimizedCode
    );
    if (assistant) {
      return assistant.assistantId;
    }
    // console.log(
    //   "No matching assistant found for the provided identifiable code."
    // );
    return null;
  } catch (err) {
    console.error("Error reading file:", err);
    return null;
  }
};

export const getAssistantIdFromSelectedCode = async (
  autoSelectedCode: string
) => {
  if (autoSelectedCode || selectedCodeWithoutReferences) {
    const assistantId = await getAssistantIdFromFile(
      autoSelectedCode || selectedCodeWithoutReferences
    );
    return assistantId;
  }
};

// export const saveAssistantIdToFile = async (
//   assistantId: string,
//   metadata: { identifiableCode: string }
// ) => {
//   const newAssistant = {
//     assistantId,
//     metadata: {
//       identifiableCode: minimizeCode(metadata.identifiableCode)
//         .replace(/[^\w]/g, "")
//         .slice(0, TOKEN_MAX_LENGTH),
//     },
//   };

//   try {
//     let existingContent: Uint8Array | null = null;
//     try {
//       existingContent = await vscode.workspace.fs.readFile(ASSISTANT_FILE_PATH);
//     } catch (error) {
//       console.info(error);
//     }
//     const assistants = !!existingContent?.byteLength
//       ? JSON.parse(new TextDecoder().decode(existingContent))
//       : [];
//     assistants.push(newAssistant);
//     const jsonData = JSON.stringify(assistants, null, 2);
//     await vscode.workspace.fs.writeFile(
//       ASSISTANT_FILE_PATH,
//       new TextEncoder().encode(jsonData)
//     );
//     console.log("Assistant has been added to the file.");
//   } catch (err) {
//     console.error("Error writing file:", err);
//   }
// };
/**
 * Saves the assistant ID and its metadata to the assistant file.
 * @param assistantId The assistant ID to save.
 * @param metadata Metadata containing the identifiable code.
 */
export const saveAssistantIdToFile = async (
  assistantId: string,
  metadata: { identifiableCode: string }
) => {
  const newAssistant = {
    assistantId,
    metadata: {
      identifiableCode: minimizeCode(metadata.identifiableCode)
        .replace(/[^\w]/g, "")
        .slice(0, TOKEN_MAX_LENGTH),
    },
  };

  try {
    let existingContent: string | null = null;
    try {
      existingContent = await fs.promises.readFile(ASSISTANT_FILE_PATH, "utf8");
    } catch (error) {
      console.info("File not found, a new one will be created.");
    }

    const assistants = existingContent ? JSON.parse(existingContent) : [];
    assistants.push(newAssistant);
    const jsonData = JSON.stringify(assistants, null, 2);

    await fs.promises.writeFile(ASSISTANT_FILE_PATH, jsonData, "utf8");
    console.log("Assistant has been added to the file.");
  } catch (err) {
    console.error("Error writing file:", err);
  }
};

// export const deleteAssistantIdFile = async () => {
//   try {
//     await vscode.workspace.fs.delete(ASSISTANT_FILE_PATH, {
//       recursive: false,
//       useTrash: true,
//     });
//     console.log("File has been deleted.");
//   } catch (err) {
//     console.error("Error deleting file:", err);
//   }
// };

/**
 * Deletes the assistant ID file.
 */
export const deleteAssistantIdFile = async () => {
  try {
    await fs.promises.unlink(ASSISTANT_FILE_PATH);
    // console.log("File has been deleted.");
  } catch (err) {
    console.error("Error deleting file:", err);
  }
};

export interface FileEmbedding {
  file: string;
  summary: string;
  code: string; //  maybe not this
  embeddings: number[];
}
// export const saveEmbeddingsToFile = async (input: FileEmbedding[]) => {
//   try {
//     const jsonData = JSON.stringify(input, null, 2); // The '2' argument adds indentation to the JSON string for readability.
//     await vscode.workspace.fs.writeFile(
//       EMBEDDINGS_FILE_PATH,
//       new TextEncoder().encode(jsonData)
//     );
//     console.log("File has been saved.");
//   } catch (err) {
//     console.error("Error writing file:", err);
//   }
// };

// export const getEmbeddingsFromFile = async () => {
//   try {
//     // Read the file content
//     const data = new TextDecoder().decode(
//       await vscode.workspace.fs.readFile(EMBEDDINGS_FILE_PATH)
//     );

//     // Parse the JSON string back to an object
//     const embeddings: FileEmbedding[] = JSON.parse(data);

//     console.log("File has been loaded and parsed.");
//     return embeddings; // Return the parsed JSON data
//   } catch (err) {
//     console.error("Error reading or parsing file:", err);
//     throw err; // Rethrow the error to handle it in the caller function if necessary
//   }
// };

export const sendMessageToChatGPT = async (
  prompt: string,
  model: "gpt-3.5-turbo" | "gpt-4o" = "gpt-4o"
): Promise<string> => {
  if (!openai) {
    throw new Error("OpenAI not initialized");
  }
  // const prompt = `
  // give me a very brief comma separated list of the key points of this file as if i were a product person. i just want to know what it's meant for. your response will be used for generating an embedding to help a product person to search through

  // ${first500Lines}
  // `;
  const completion = await openai.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model,
  });
  return completion?.choices[0].message.content || "";
};

export const createAndStoreAssistant = async (
  name: string,
  identifiableCode: string,
  instructions?: string
) => {
  if (!openai) {
    throw new Error("OpenAI not initialized");
  }

  const myAssistant = await openai.beta.assistants.create({
    instructions,
    // name: "celp",
    name,
    tools: [{ type: "code_interpreter" }],
    model: "gpt-4o",
  });

  if (myAssistant.id) {
    await saveAssistantIdToFile(myAssistant.id, { identifiableCode });
  }
  return myAssistant;
};

export const getSystemMessageContent = (
  messagesPage: OpenAI.Beta.Threads.Messages.MessagesPage
) => {
  // console.log({ messagesPage });
  const assistantMessageWithTimestamps = messagesPage.data
    .filter((d) => d.role === "assistant" && d.content[0].type === "text")
    .map((d) => {
      const content = d.content[0];
      if (!("text" in content)) {
        return { createdAt: d.created_at, content: "" };
      }
      return { createdAt: d.created_at, content: content.text.value };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  const combined = assistantMessageWithTimestamps[0].content;
  // .map((m) => m.content)
  // .join("\n\n");
  return combined;
};

export const sendMessageToAssistant = async (
  content: string,
  model?: "gpt-3.5-turbo" | "gpt-4o",
  instructions?: string,
  isJson?: boolean
) => {
  // console.log('running sendMessageToAssistant')
  // console.log('with content', content)
  if (!openai) {
    throw new Error("OpenAI not initialized");
  }

  // const assistantId = await getAssistantIdFromFile();
  const assistantId = await getAssistantIdFromSelectedCode(
    selectedCodeWithoutReferences
  );
  let threadId = await getThreadIdFromFile();

  if (!assistantId) {
    throw new Error("Failed to obtain a valid Assistant ID");
  }

  let run: OpenAI.Beta.Threads.Runs.Run | null = null;
  if (!threadId) {
    // create new thread
    // const emptyThread = await openai.beta.threads.create();
    // threadId = emptyThread.id

    run = await openai.beta.threads.createAndRun({
      assistant_id: assistantId,
      instructions,
      model,
      thread: {
        messages: [{ role: "user", content }],
      },
      response_format: { type: isJson ? "json_object" : "text" },
    });
  } else {
    const threadMessages = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content,
    });
    run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      model,
      instructions,
      response_format: { type: isJson ? "json_object" : "text" },
    });
  }

  let attempts = 0;
  const maxAttempts = 500;
  let fetchedRun: OpenAI.Beta.Threads.Runs.Run | null = null;
  while (attempts < maxAttempts && !fetchedRun?.completed_at) {
    await delay(1000);
    fetchedRun = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);
    attempts += 1;
  }

  if (fetchedRun?.completed_at) {
    const threadMessages = await openai.beta.threads.messages.list(
      run.thread_id
    );
    const assistantMessages = getSystemMessageContent(threadMessages);
    if (!threadId) {
      threadId = run.thread_id;
      await saveThreadIdToFile(run.thread_id);
    }
    return {
      message: assistantMessages,
      threadId,
    };
  }
};

export const generateEmbedding = async (input: string) => {
  if (!openai) {
    throw new Error("OpenAI not initialized");
  }

  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input,
  });
  return embedding;
};

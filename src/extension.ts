// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// System-level prompt for SHACL Guru
const BASE_PROMPT = `You are an expert SHACL (Shapes Constraint Language) assistant integrated into VSCode.
Your primary goal is to help users create, understand, modify, and learn about SHACL shapes.
You should generate SHACL shapes in Turtle syntax unless otherwise specified.
Always strive for accuracy and adhere to SHACL Core specifications and best practices.
When generating SHACL, clearly define NodeShapes and PropertyShapes, and use appropriate constraint components.
If the user provides context (like a selection or a file via #selection or #file), prioritize using that information.
If a user's request is ambiguous, ask clarifying questions.
For explanations, be clear and concise, and use Chain-of-Thought reasoning where it helps illustrate a concept or a shape's logic.
Offer follow-up suggestions when appropriate to guide the user.
You have access to the user's current editor selection (#selection) and active file content (#file).
The current time is ${new Date().toLocaleString()}.`;

const SHACL_SYSTEM_PROMPT = `You are an expert SHACL (Shapes Constraint Language) assistant integrated into VSCode.
Your primary goal is to help users create, understand, modify, and learn about SHACL shapes.
You should always generate SHACL shapes in Turtle (.ttl) syntax unless otherwise specified.
Always strive for accuracy and adhere to SHACL Core specifications and best practices.
When generating SHACL, clearly define NodeShapes and PropertyShapes, and use appropriate constraint components.
If the user provides context (like a selection or a file via '#selection' or '#file' chat variables), prioritize using that information.
If a user's request is ambiguous, ask clarifying questions.
For explanations, be clear and concise, and use Chain-of-Thought reasoning where it helps illustrate a concept or a shape's logic.
After your main response, suggest 2-3 relevant follow-up questions the user might ask, formatted as a list. For example:
Follow-up suggestions:
* How do I ...?
* What if ...?`;

// Helper: Get editor selection or file content for #selection/#file
async function getEditorContext(): Promise<{
  selection?: string;
  fileContent?: string;
}> {
  const editor = vscode.window.activeTextEditor;
  let selection, fileContent;
  if (editor) {
    const sel = editor.selection;
    if (!sel.isEmpty) {
      selection = editor.document.getText(sel);
    }
    fileContent = editor.document.getText();
  }
  return { selection, fileContent };
}

// Helper: Compose prompt based on command and user input
async function buildPrompt(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext
): Promise<string> {
  let intent = "unknown";
  let userQuery = request.prompt; // The raw text from the user
  let structuredPrompt = `${BASE_PROMPT}\n\nUser: ${userQuery}`;

  // --- Handle #selection variable ---
  let selectionText = ""; // Default to empty string
  const { selection, fileContent } = await getEditorContext();
  if (selection) {
    selectionText += selection;
  }
  // --- Handle #file variable ---
  if (!selectionText && fileContent) {
    selectionText += fileContent;
  }

  //           );
  //           selectionText = firstSelection.range
  //             ? document.getText(firstSelection.range)
  //             : document.getText();
  //         } catch (e) {
  //           console.error("Error reading selection from URI:", e);
  //           // We'll let the main handler inform the user
  //           throw new Error("Failed to read editor selection.");
  //         }
  //       }
  //     }
  //   }

  // --- Determine Intent ---
  if (request.command) {
    userQuery = `/${request.command} ${request.prompt}`; // Full command for logging/context
    intent = request.command;
  } else {
    const lowerPrompt = request.prompt.toLowerCase();
    if (
      lowerPrompt.includes("create a shape for") ||
      lowerPrompt.includes("generate a shape for")
    ) {
      intent = "infer-shape";
    } else if (
      lowerPrompt.startsWith("explain sh:") ||
      lowerPrompt.startsWith("what is sh:") ||
      lowerPrompt.startsWith("tell me about sh:")
    ) {
      intent = "explain"; // Generic explain, specific concept handled by LLM
    } else if (
      lowerPrompt.includes("best practices") ||
      lowerPrompt.includes("tips for shacl")
    ) {
      intent = "bestPractices";
    } else if (
      (lowerPrompt.includes("example rdf") ||
        lowerPrompt.includes("sample rdf")) &&
      selectionText
    ) {
      intent = "exampleRDF";
    } else if (
      lowerPrompt.includes("add") &&
      (lowerPrompt.includes("constraint") ||
        lowerPrompt.includes("property")) &&
      selectionText
    ) {
      intent = "addConstraint";
    }
    // If intent is still 'unknown', the LLM will get the general userQuery
  }

  // --- Structure the prompt based on intent ---
  switch (intent) {
    case "infer-shape":
      structuredPrompt = `
The user wants to create a SHACL shape.
User's description: "${request.prompt}"

Please generate the SHACL shape in Turtle syntax.
Follow these guidelines:
1.  Identify the main entity/class to be shaped.
2.  Determine its node kind (e.g., sh:IRI) and target (e.g., sh:targetClass ex:YourClass).
3.  For each property derived from the user's description:
    a.  Use appropriate property IRIs (e.g., foaf:name, schema:email, or ex:yourProperty).
    b.  Define constraints like sh:datatype, sh:minCount, sh:maxCount, sh:nodeKind (for resource values), sh:class (if the value should conform to another shape).
    c.  Include sh:name and sh:description for clarity.
4.  Include necessary @prefix declarations.
5.  If the description mentions inferring from RDF (and #selection is present), use the selected RDF to guide the shape generation.
    ${
      selectionText
        ? `Selected RDF context to consider:\n\`\`\`\n${selectionText}\n\`\`\``
        : ""
    }
6.  After the Turtle code block, briefly state any assumptions made.`;
      break;

    case "explain":
      if (selectionText) {
        structuredPrompt = `
The user wants an explanation of the following selected SHACL snippet:
\`\`\`shacl
${selectionText}
\`\`\`
User's specific question about the selection (if any): "${request.prompt}"

Please provide a detailed explanation:
1.  Identify the main SHACL construct (NodeShape, PropertyShape, specific constraint component).
2.  Explain its purpose and how it functions.
3.  If it's a NodeShape, explain its targets and any sh:nodeKind.
4.  For each \`sh:property\` block, detail the path and all applied constraints (datatype, cardinality, patterns, class constraints, etc.).
5.  Summarize what data would conform to or violate this snippet. Use Chain-of-Thought if it helps clarify complex interactions.`;
      } else {
        structuredPrompt = `
The user wants an explanation of a SHACL concept.
User's question: "${request.prompt}"

Please explain the SHACL concept clearly:
1.  Define the concept.
2.  Explain its purpose and common use cases.
3.  Provide a simple example in Turtle syntax.
4.  Mention any important considerations or best practices related to it.`;
      }
      break;

    case "add-constraint": // Assumes selectionText is present
      structuredPrompt = `
The user wants to add a constraint or property to the selected SHACL shape.
Selected SHACL shape:
\`\`\`shacl
${selectionText}
\`\`\`
User's request for modification: "${request.prompt}"

Please modify the provided SHACL shape according to the user's request and output the complete, updated SHACL shape in Turtle syntax.
Ensure the new constraint is correctly integrated.`;
      break;

    case "best-practices":
      structuredPrompt = `
The user is asking for SHACL best practices.

Please provide a comprehensive list of key best practices for writing effective SHACL shapes, including but not limited to:
- Data understanding
- Targeting
- Constraint specificity
- Reusability (sh:node, constraint components)
- Readability (sh:name, sh:description, sh:message)
- Severities
- Incremental development and testing
- Use of sh:closed and sh:ignoredProperties.
For each best practice, provide a brief explanation.`;
      break;
    case "help":
      structuredPrompt = `
The user wants to see help information for SHACL Guru.

Please provide a comprehensive help guide with the following sections:
1. Available Commands:
   - Generate Shape: How to create new SHACL shapes from descriptions
   - Explain: How to get explanations of SHACL concepts or selected code
   - Add Constraint: How to add constraints to existing SHACL shapes
   - Best Practices: How to get SHACL best practices
   - Example RDF: How to generate conforming or violating RDF examples
   - Help: How to access this help information

2. Feature Examples:
   - Show examples of how to use each command with sample queries
   - Explain how to use the #selection and #file context

3. Tips:
   - How to get the most out of SHACL Guru
   - Keyboard shortcuts (if applicable)
   - How to provide feedback

Format the help as a clear, well-structured markdown document with sections and examples.`;
      break;
    case "exampleRDF":
    case "generate-conforming": // Assumes selectionText (the shape) is present
    case "generate-violating":
      let conformOrViolate = request.prompt.toLowerCase().includes("violate")
        ? "violating"
        : "conforming";
      structuredPrompt = `
The user wants an example of RDF data that is ${conformOrViolate} to the selected SHACL shape.
Selected SHACL shape:
\`\`\`shacl
${selectionText}
\`\`\`
User's specific request (if any): "${request.prompt}"

Please generate a concise RDF snippet in Turtle syntax that is ${conformOrViolate} to the provided shape.
If generating violating RDF, clearly explain *why* it violates the shape, referencing specific constraints.
If generating conforming RDF, briefly explain *why* it conforms.`;
      break;

    default: // Fallback for 'unknown' intent or unhandled commands
      structuredPrompt = userQuery; // The raw user query (potentially with command)
      if (selectionText) {
        structuredPrompt += `\n\nSelected editor context (#selection):\n\`\`\`\n${selectionText}\n\`\`\``;
      }
      structuredPrompt +=
        "\nPlease provide a helpful and accurate SHACL-related response. If generating SHACL, use Turtle. If explaining, be clear. For all responses, suggest 2-3 relevant follow-up questions.";
      intent = "unknown_fallback"; // Mark for clarity
      break;
  }
  return structuredPrompt;
}

export function activate(context: vscode.ExtensionContext) {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult | undefined> => {
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(SHACL_SYSTEM_PROMPT),
    ];

    // --- History (optional, can be refined based on token limits) ---
    // This simple history includes last few user/assistant turns.
    const historyLimit = 5; // Take last 5 turns
    const relevantHistory = chatContext.history.slice(-historyLimit);

    for (const historyTurn of relevantHistory) {
      if (historyTurn instanceof vscode.ChatRequestTurn) {
        let userQuery = historyTurn.prompt;
        if (historyTurn.command) {
          userQuery = `/${historyTurn.command} ${userQuery}`;
        }
        messages.push(vscode.LanguageModelChatMessage.User(userQuery));
      } else if (historyTurn instanceof vscode.ChatResponseTurn) {
        let assistantResponse = "";
        historyTurn.response.forEach((part) => {
          if (part instanceof vscode.ChatResponseMarkdownPart) {
            assistantResponse += part.value;
          }
        });
        if (assistantResponse.trim()) {
          messages.push(
            vscode.LanguageModelChatMessage.Assistant(assistantResponse)
          );
        }
      }
    }

    // --- Structure current user prompt ---
    let structuredUserMessageContent: string;
    try {
      const structuredPrompt = await buildPrompt(request, chatContext);
      structuredUserMessageContent = structuredPrompt;
    } catch (e: any) {
      stream.markdown(
        e.message || "Sorry, I couldn't process part of your request."
      );
      return {
        errorDetails: {
          message: e.message || "Error processing request variables.",
        },
      };
    }

    messages.push(
      vscode.LanguageModelChatMessage.User(structuredUserMessageContent)
    );

    // --- Send to LLM and stream response ---
    try {
      if (!request.model) {
        stream.markdown(
          "I'm sorry, I can't respond right now. No language model is available."
        );
        return { errorDetails: { message: "No language model available." } };
      }

      const chatResponse = await request.model.sendRequest(messages, {}, token);

      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
      }
    } catch (error) {
      console.error("Error sending request to Language Model:", error);
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred.";
      stream.markdown(
        `Sorry, I encountered an error while trying to respond: ${errorMessage}`
      );
      return {
        errorDetails: { message: `LLM request failed: ${errorMessage}` },
      };
    }

    return {}; // Indicate success
  };

  const shaclParticipant = vscode.chat.createChatParticipant(
    "shacl-guru.chatParticipant",
    handler
  );
  try {
    shaclParticipant.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      "shacl-icon.png"
    ); // Ensure you have this icon
  } catch (e) {
    console.warn("Could not set SHACL participant icon:", e);
  }

  context.subscriptions.push(shaclParticipant);
}

export function deactivate() {}

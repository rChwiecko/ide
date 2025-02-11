import { usePuter } from "./puter.js";
const diff_match = window.dmp;

const API_KEY = ""; // Get yours at https://platform.sulu.sh/apis/judge0

const AUTH_HEADERS = API_KEY
  ? {
      Authorization: `Bearer ${API_KEY}`,
    }
  : {};

const CE = "CE";
const EXTRA_CE = "EXTRA_CE";

const AUTHENTICATED_CE_BASE_URL = "https://judge0-ce.p.sulu.sh";
const AUTHENTICATED_EXTRA_CE_BASE_URL = "https://judge0-extra-ce.p.sulu.sh";

var AUTHENTICATED_BASE_URL = {};
AUTHENTICATED_BASE_URL[CE] = AUTHENTICATED_CE_BASE_URL;
AUTHENTICATED_BASE_URL[EXTRA_CE] = AUTHENTICATED_EXTRA_CE_BASE_URL;

const UNAUTHENTICATED_CE_BASE_URL = "https://ce.judge0.com";
const UNAUTHENTICATED_EXTRA_CE_BASE_URL = "https://extra-ce.judge0.com";

var UNAUTHENTICATED_BASE_URL = {};
UNAUTHENTICATED_BASE_URL[CE] = UNAUTHENTICATED_CE_BASE_URL;
UNAUTHENTICATED_BASE_URL[EXTRA_CE] = UNAUTHENTICATED_EXTRA_CE_BASE_URL;

const INITIAL_WAIT_TIME_MS = 0;
const WAIT_TIME_FUNCTION = (i) => 100;
const MAX_PROBE_REQUESTS = 50;

var fontSize = 13;

var layout;

var sourceEditor;
var stdinEditor;
var stdoutEditor;

var $selectLanguage;
var $compilerOptions;
var $commandLineArguments;
var $runBtn;
var $statusLine;

var timeStart;

var sqliteAdditionalFiles;
var languages = {};

// Initialize messages as an empty array; we'll add our system prompt later
let messages = [];

var layoutConfig = {
  settings: {
    showPopoutIcon: false,
    reorderEnabled: true,
  },
  content: [
    {
      type: "row",
      content: [
        {
          type: "component",
          width: 50,
          componentName: "source",
          id: "source",
          title: "Source Code",
          isClosable: false,
          componentState: { readOnly: false },
        },
        {
          type: "column",
          content: [
            {
              type: "component",
              componentName: "stdin",
              id: "stdin",
              title: "Input",
              isClosable: false,
              componentState: { readOnly: false },
            },
            {
              type: "component",
              componentName: "stdout",
              id: "stdout",
              title: "Output",
              isClosable: false,
              componentState: { readOnly: true },
            },
            {
              type: "component",
              componentName: "aiAssistant",
              id: "ai-assistant",
              title: "AI Assistant",
              isClosable: false,
              componentState: { readOnly: true },
            },
          ],
        },
      ],
    },
  ],
};

var gPuterFile;

function encode(str) {
  return btoa(unescape(encodeURIComponent(str || "")));
}

function decode(bytes) {
  var escaped = escape(atob(bytes || ""));
  try {
    return decodeURIComponent(escaped);
  } catch {
    return unescape(escaped);
  }
}

function getGroqClient() {
  if (!window.groqClient) {
    throw new Error("Groq client not initialized");
  }
  return window.groqClient;
}

// Updated getGroqChatCompletion function:
async function getGroqChatCompletion(query) {
  try {
    const groq = getGroqClient();
    // Here we assume that the system prompt is already in messages.
    // We simply push the user query.
    messages.push({
      role: "user",
      content: query,
    });

    const chatCompletion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 4000,
    });

    if (chatCompletion.choices[0]?.message?.content) {
      messages.push({
        role: "assistant",
        content: chatCompletion.choices[0].message.content,
      });
    }

    // Keep only last 10 messages to manage context window.
    if (messages.length > 10) {
      messages = messages.slice(-10);
    }

    return chatCompletion;
  } catch (error) {
    console.error("Groq API Error:", error);
    throw error;
  }
}

function showError(title, content) {
  $("#judge0-site-modal #title").html(title);
  $("#judge0-site-modal .content").html(content);

  let reportTitle = encodeURIComponent(`Error on ${window.location.href}`);
  let reportBody = encodeURIComponent(
    `**Error Title**: ${title}\n` +
      `**Error Timestamp**: \`${new Date()}\`\n` +
      `**Origin**: ${window.location.href}\n` +
      `**Description**:\n${content}`
  );

  $("#report-problem-btn").attr(
    "href",
    `https://github.com/judge0/ide/issues/new?title=${reportTitle}&body=${reportBody}`
  );
  $("#judge0-site-modal").modal("show");
}

function showHttpError(jqXHR) {
  showError(
    `${jqXHR.statusText} (${jqXHR.status})`,
    `<pre>${JSON.stringify(jqXHR, null, 4)}</pre>`
  );
}

function handleRunError(jqXHR) {
  showHttpError(jqXHR);
  $runBtn.removeClass("loading");

  window.top.postMessage(
    JSON.parse(
      JSON.stringify({
        event: "runError",
        data: jqXHR,
      })
    ),
    "*"
  );
}

function handleResult(data) {
  const tat = Math.round(performance.now() - timeStart);
  console.log(`It took ${tat}ms to get submission result.`);

  const status = data.status;
  const stdout = decode(data.stdout);
  const compileOutput = decode(data.compile_output);
  const time = data.time === null ? "-" : data.time + "s";
  const memory = data.memory === null ? "-" : data.memory + "KB";

  $statusLine.html(`${status.description}, ${time}, ${memory} (TAT: ${tat}ms)`);

  const output = [compileOutput, stdout].join("\n").trim();

  stdoutEditor.setValue(output);

  $runBtn.removeClass("loading");

  window.top.postMessage(
    JSON.parse(
      JSON.stringify({
        event: "postExecution",
        status: data.status,
        time: data.time,
        memory: data.memory,
        output: output,
      })
    ),
    "*"
  );
}

async function getSelectedLanguage() {
  return getLanguage(getSelectedLanguageFlavor(), getSelectedLanguageId());
}

function getSelectedLanguageId() {
  return parseInt($selectLanguage.val());
}

function getSelectedLanguageFlavor() {
  return $selectLanguage.find(":selected").attr("flavor");
}

function run() {
  if (sourceEditor.getValue().trim() === "") {
    showError("Error", "Source code can't be empty!");
    return;
  } else {
    $runBtn.addClass("loading");
  }

  stdoutEditor.setValue("");
  $statusLine.html("");

  let x = layout.root.getItemsById("stdout")[0];
  x.parent.header.parent.setActiveContentItem(x);

  let sourceValue = encode(sourceEditor.getValue());
  let stdinValue = encode(stdinEditor.getValue());
  let languageId = getSelectedLanguageId();
  let compilerOptions = $compilerOptions.val();
  let commandLineArguments = $commandLineArguments.val();

  let flavor = getSelectedLanguageFlavor();

  if (languageId === 44) {
    sourceValue = sourceEditor.getValue();
  }

  let data = {
    source_code: sourceValue,
    language_id: languageId,
    stdin: stdinValue,
    compiler_options: compilerOptions,
    command_line_arguments: commandLineArguments,
    redirect_stderr_to_stdout: true,
  };

  let sendRequest = function (data) {
    window.top.postMessage(
      JSON.parse(
        JSON.stringify({
          event: "preExecution",
          source_code: sourceEditor.getValue(),
          language_id: languageId,
          flavor: flavor,
          stdin: stdinEditor.getValue(),
          compiler_options: compilerOptions,
          command_line_arguments: commandLineArguments,
        })
      ),
      "*"
    );

    timeStart = performance.now();
    $.ajax({
      url: `${AUTHENTICATED_BASE_URL[flavor]}/submissions?base64_encoded=true&wait=false`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(data),
      headers: AUTH_HEADERS,
      success: function (data, textStatus, request) {
        console.log(`Your submission token is: ${data.token}`);
        let region = request.getResponseHeader("X-Judge0-Region");
        setTimeout(
          fetchSubmission.bind(null, flavor, region, data.token, 1),
          INITIAL_WAIT_TIME_MS
        );
      },
      error: handleRunError,
    });
  };

  if (languageId === 82) {
    if (!sqliteAdditionalFiles) {
      $.ajax({
        url: `./data/additional_files_zip_base64.txt`,
        contentType: "text/plain",
        success: function (responseData) {
          sqliteAdditionalFiles = responseData;
          data["additional_files"] = sqliteAdditionalFiles;
          sendRequest(data);
        },
        error: handleRunError,
      });
    } else {
      data["additional_files"] = sqliteAdditionalFiles;
      sendRequest(data);
    }
  } else {
    sendRequest(data);
  }
}

function fetchSubmission(flavor, region, submission_token, iteration) {
  if (iteration >= MAX_PROBE_REQUESTS) {
    handleRunError(
      {
        statusText: "Maximum number of probe requests reached.",
        status: 504,
      },
      null,
      null
    );
    return;
  }

  $.ajax({
    url: `${UNAUTHENTICATED_BASE_URL[flavor]}/submissions/${submission_token}?base64_encoded=true`,
    headers: {
      "X-Judge0-Region": region,
    },
    success: function (data) {
      if (data.status.id <= 2) {
        // In Queue or Processing
        $statusLine.html(data.status.description);
        setTimeout(
          fetchSubmission.bind(
            null,
            flavor,
            region,
            submission_token,
            iteration + 1
          ),
          WAIT_TIME_FUNCTION(iteration)
        );
      } else {
        handleResult(data);
      }
    },
    error: handleRunError,
  });
}

function setSourceCodeName(name) {
  $(".lm_title")[0].innerText = name;
}

function getSourceCodeName() {
  return $(".lm_title")[0].innerText;
}

function openFile(content, filename) {
  clear();
  sourceEditor.setValue(content);
  selectLanguageForExtension(filename.split(".").pop());
  setSourceCodeName(filename);
}

function saveFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

async function openAction() {
  if (usePuter()) {
    gPuterFile = await puter.ui.showOpenFilePicker();
    openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
  } else {
    document.getElementById("open-file-input").click();
  }
}

async function saveAction() {
  if (usePuter()) {
    if (gPuterFile) {
      gPuterFile.write(sourceEditor.getValue());
    } else {
      gPuterFile = await puter.ui.showSaveFilePicker(
        sourceEditor.getValue(),
        getSourceCodeName()
      );
      setSourceCodeName(gPuterFile.name);
    }
  } else {
    saveFile(sourceEditor.getValue(), getSourceCodeName());
  }
}

function setFontSizeForAllEditors(fontSize) {
  sourceEditor.updateOptions({ fontSize: fontSize });
  stdinEditor.updateOptions({ fontSize: fontSize });
  stdoutEditor.updateOptions({ fontSize: fontSize });
}

async function loadLangauges() {
  return new Promise((resolve, reject) => {
    let options = [];

    $.ajax({
      url: UNAUTHENTICATED_CE_BASE_URL + "/languages",
      success: function (data) {
        for (let i = 0; i < data.length; i++) {
          let language = data[i];
          let option = new Option(language.name, language.id);
          option.setAttribute("flavor", CE);
          option.setAttribute(
            "langauge_mode",
            getEditorLanguageMode(language.name)
          );

          if (language.id !== 89) {
            options.push(option);
          }

          if (language.id === DEFAULT_LANGUAGE_ID) {
            option.selected = true;
          }
        }
      },
      error: reject,
    }).always(function () {
      $.ajax({
        url: UNAUTHENTICATED_EXTRA_CE_BASE_URL + "/languages",
        success: function (data) {
          for (let i = 0; i < data.length; i++) {
            let language = data[i];
            let option = new Option(language.name, language.id);
            option.setAttribute("flavor", EXTRA_CE);
            option.setAttribute(
              "langauge_mode",
              getEditorLanguageMode(language.name)
            );

            if (
              options.findIndex((t) => t.text === option.text) === -1 &&
              language.id !== 89
            ) {
              options.push(option);
            }
          }
        },
        error: reject,
      }).always(function () {
        options.sort((a, b) => a.text.localeCompare(b.text));
        $selectLanguage.append(options);
        resolve();
      });
    });
  });
}

async function loadSelectedLanguage(skipSetDefaultSourceCodeName = false) {
  monaco.editor.setModelLanguage(
    sourceEditor.getModel(),
    $selectLanguage.find(":selected").attr("langauge_mode")
  );

  if (!skipSetDefaultSourceCodeName) {
    setSourceCodeName((await getSelectedLanguage()).source_file);
  }
}

// Updated callAICodeAssistant using regex to capture entire code block and clear it from the response.
// Also detects a language change request marked by @@@language@@@ and updates both the editor and compiler.
async function callAICodeAssistant(query) {
  try {
    // Get the current code from the source editor.
    const codeContext = sourceEditor.getValue();

    // Build a prompt that includes both the code context and the user's instruction.
    const fullPrompt =
      `I'm working on the following code:\n\n${codeContext}\n\n` +
      `Please make the following changes:\n${query}`;

    // Add the user message to history.
    messages.push({
      role: "user",
      content: fullPrompt,
    });

    // Get the completion from Groq.
    const chatCompletion = await getGroqChatCompletion(query);

    if (
      chatCompletion &&
      chatCompletion.choices &&
      chatCompletion.choices.length > 0 &&
      chatCompletion.choices[0].message &&
      chatCompletion.choices[0].message.content
    ) {
      let aiResponse = chatCompletion.choices[0].message.content;
      messages.push({
        role: "assistant",
        content: aiResponse,
      });

      // Keep only the last 10 messages.
      if (messages.length > 10) {
        messages = messages.slice(-10);
      }

      // Check for a code block enclosed in triple backticks.
      const codeBlockRegex = /```(?:\w*\n)?([\s\S]*?)```/;
      const codeMatch = aiResponse.match(codeBlockRegex);
      if (codeMatch && codeMatch[1].trim().length > 0) {
        // Extract the updated code.
        const newCode = codeMatch[1].trim();
        console.log("Extracted new code:", newCode);

        // Update the source editor with the new code.
        sourceEditor.setValue(newCode);

        // Remove the code block from the response so the user doesn't see it.
        aiResponse = aiResponse.replace(codeBlockRegex, "").trim();
      }

      // Detect a language change marker marked by @@@language@@@.
      const languageMarkerRegex = /@@@([\w\s\+\#]+)@@@/;
      const languageMatch = aiResponse.match(languageMarkerRegex);
      if (languageMatch && languageMatch[1].trim().length > 0) {
        const requestedLanguage = languageMatch[1].trim();
        console.log("Language change requested:", requestedLanguage);

        // Use the helper function to get the expected editor mode.
        const newEditorMode = getEditorLanguageMode(requestedLanguage);
        console.log("New editor mode determined:", newEditorMode);

        // Update the Monaco editor language.
        monaco.editor.setModelLanguage(sourceEditor.getModel(), newEditorMode);

        // Update the language dropdown based on the "langauge_mode" attribute.
        let foundValue = null;
        $selectLanguage.find("option").each(function () {
          const optionMode = $(this).attr("langauge_mode");
          if (
            optionMode &&
            optionMode.toLowerCase() === newEditorMode.toLowerCase()
          ) {
            foundValue = $(this).val();
          }
        });
        if (foundValue) {
          $selectLanguage.val(foundValue);
          // Refresh the UI if using Semantic UI dropdown.
          if ($selectLanguage.dropdown) {
            $selectLanguage.dropdown("set selected", foundValue);
          }
        } else {
          console.warn(
            "No matching language option found for mode:",
            newEditorMode
          );
        }
        // Remove the language marker from the response.
        aiResponse = aiResponse.replace(languageMarkerRegex, "").trim();
      }

      // Return the cleaned-up response.
      return aiResponse;
    } else {
      return "No valid response received from the Groq API.";
    }
  } catch (error) {
    console.error("Error fetching Groq chat completion:", error);
    return `Error: ${error.message || "Unknown error"}`;
  }
}

function selectLanguageByFlavorAndId(languageId, flavor) {
  let option = $selectLanguage.find(`[value=${languageId}][flavor=${flavor}]`);
  if (option.length) {
    option.prop("selected", true);
    $selectLanguage.trigger("change", { skipSetDefaultSourceCodeName: true });
  }
}

function selectLanguageForExtension(extension) {
  let language = getLanguageForExtension(extension);
  selectLanguageByFlavorAndId(language.language_id, language.flavor);
}

async function getLanguage(flavor, languageId) {
  return new Promise((resolve, reject) => {
    if (languages[flavor] && languages[flavor][languageId]) {
      resolve(languages[flavor][languageId]);
      return;
    }

    $.ajax({
      url: `${UNAUTHENTICATED_BASE_URL[flavor]}/languages/${languageId}`,
      success: function (data) {
        if (!languages[flavor]) {
          languages[flavor] = {};
        }
        languages[flavor][languageId] = data;
        resolve(data);
      },
      error: reject,
    });
  });
}

function setDefaults() {
  setFontSizeForAllEditors(fontSize);
  sourceEditor.setValue(DEFAULT_SOURCE);
  stdinEditor.setValue(DEFAULT_STDIN);
  $compilerOptions.val(DEFAULT_COMPILER_OPTIONS);
  $commandLineArguments.val(DEFAULT_CMD_ARGUMENTS);

  $statusLine.html("");

  loadSelectedLanguage();
}

function clear() {
  sourceEditor.setValue("");
  stdinEditor.setValue("");
  $compilerOptions.val("");
  $commandLineArguments.val("");

  $statusLine.html("");
}


// A dedicated auto-complete function for a single line.
// This function does not track conversation history.
async function autoCompleteLine(incompleteLine) {
    // Hardcoded system prompt for auto-completion.
    const systemPrompt =
      "You are a code auto-completion assistant. Your task is to complete the given incomplete line of code. " +
      "Respond ONLY with the complete code enclosed within triple backticks (```), and nothing else.";
  
    // Build the user prompt.
    const userPrompt = `Complete the following line of code:\n${incompleteLine}`;
  
    // Create a temporary messages array containing only the system and user messages.
    const messagesForCompletion = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
  
    try {
      // Get the Groq client instance.
      const groq = getGroqClient();
  
      // Request a completion from the model.
      const chatCompletion = await groq.chat.completions.create({
        messages: messagesForCompletion,
        model: "llama-3.3-70b-versatile",
        temperature: 0.7,
        max_tokens: 400, // Adjust as needed for the expected completion length.
      });
  
      // Extract the response content.
      if (
        chatCompletion &&
        chatCompletion.choices &&
        chatCompletion.choices.length > 0 &&
        chatCompletion.choices[0].message &&
        chatCompletion.choices[0].message.content
      ) {
        let response = chatCompletion.choices[0].message.content;
  
        // Use regex to extract the code enclosed within triple backticks.
        const codeBlockRegex = /```([\s\S]*?)```/;
        const match = response.match(codeBlockRegex);
  
        if (match && match[1].trim().length > 0) {
          // Return only the code inside the backticks.
          return match[1].trim();
        } else {
          // If the response does not contain a code block, return an empty string.
          return "";
        }
      } else {
        return "";
      }
    } catch (error) {
      console.error("Auto-complete error:", error);
      return "";
    }
  }
  

function refreshSiteContentHeight() {
  const navigationHeight = document.getElementById(
    "judge0-site-navigation"
  ).offsetHeight;

  const siteContent = document.getElementById("judge0-site-content");
  siteContent.style.height = `${window.innerHeight}px`;
  siteContent.style.paddingTop = `${navigationHeight}px`;
}

function refreshLayoutSize() {
  refreshSiteContentHeight();
  layout.updateSize();
}

window.addEventListener("resize", refreshLayoutSize);
document.addEventListener("DOMContentLoaded", async function () {
  $("#select-language").dropdown();
  $("[data-content]").popup({
    lastResort: "left center",
  });

  refreshSiteContentHeight();

  console.log(
    "Hey, Judge0 IDE is open-sourced: https://github.com/judge0/ide. Have fun!"
  );

  $selectLanguage = $("#select-language");
  $selectLanguage.change(function (event, data) {
    let skipSetDefaultSourceCodeName =
      (data && data.skipSetDefaultSourceCodeName) || !!gPuterFile;
    loadSelectedLanguage(skipSetDefaultSourceCodeName);
  });

  await loadLangauges();

  $compilerOptions = $("#compiler-options");
  $commandLineArguments = $("#command-line-arguments");

  $runBtn = $("#run-btn");
  $runBtn.click(run);

  $("#open-file-input").change(function (e) {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = function (e) {
        openFile(e.target.result, selectedFile.name);
      };

      reader.onerror = function (e) {
        showError("Error", "Error reading file: " + e.target.error);
      };

      reader.readAsText(selectedFile);
    }
  });

  $statusLine = $("#judge0-status-line");

  $(document).on("keydown", "body", function (e) {
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case "Enter": // Ctrl+Enter, Cmd+Enter
          e.preventDefault();
          run();
          break;
        case "s": // Ctrl+S, Cmd+S
          e.preventDefault();
          save();
          break;
        case "o": // Ctrl+O, Cmd+O
          e.preventDefault();
          open();
          break;
        case "+": // Ctrl+Plus
        case "=": // Some layouts use '=' for '+'
          e.preventDefault();
          fontSize += 1;
          setFontSizeForAllEditors(fontSize);
          break;
        case "-": // Ctrl+Minus
          e.preventDefault();
          fontSize -= 1;
          setFontSizeForAllEditors(fontSize);
          break;
        case "0": // Ctrl+0
          e.preventDefault();
          fontSize = 13;
          setFontSizeForAllEditors(fontSize);
          break;
      }
    }
  });

  require(["vs/editor/editor.main"], function (ignorable) {
    layout = new GoldenLayout(layoutConfig, $("#judge0-site-content"));

    layout.registerComponent("source", function (container, state) {
      sourceEditor = monaco.editor.create(container.getElement()[0], {
        automaticLayout: true,
        scrollBeyondLastLine: true,
        readOnly: state.readOnly,
        language: "cpp",
        fontFamily: "JetBrains Mono",
        minimap: {
          enabled: true,
        },
      });

        let completionTimer = null;
        let lastLineNumber = null;

        sourceEditor.onDidChangeCursorPosition((e) => {
            const position = sourceEditor.getPosition();
            const currentLineNumber = position.lineNumber;
            const lineContent = sourceEditor.getModel().getLineContent(currentLineNumber);
            console.log("Current line content:", lineContent);

            // If we're on a new line, clear any existing timer
            if (lastLineNumber !== currentLineNumber) {
                if (completionTimer) {
                clearTimeout(completionTimer);
                completionTimer = null;
                }
                lastLineNumber = currentLineNumber;
            }

            // Reset the timer every time a change is detected on the same line.
            if (completionTimer) {
                clearTimeout(completionTimer);
            }
            
            // Start a new timer (2 seconds)
            completionTimer = setTimeout(async () => {
                // Check if the line appears incomplete.
                // This heuristic might be as simple as checking if the line does not end with a semicolon
                // or if it matches a pattern that suggests it's incomplete.
                // Adjust this logic to suit your language and needs.
                if (!isLineComplete(lineContent)) {
                console.log(`Line ${currentLineNumber} appears incomplete. Triggering auto-complete.`);
                const completion = await autoCompleteLine(lineContent);
                if (completion) {
                    // Optionally, you might display the completion as inline ghost text
                    // or insert it into the document.
                    console.log("Auto-completion suggestion:", completion);
                    // For example, you could automatically insert the completion:
                    // sourceEditor.executeEdits("", [{ range: new monaco.Range(currentLineNumber, lineContent.length + 1, currentLineNumber, lineContent.length + 1), text: completion }]);
                }
                }
            }, 2000); // 2000 milliseconds = 2 seconds
        });

        // A helper function to decide whether a line is complete.
        // You can customize this logic based on your requirements.
        function isLineComplete(line) {
        // For example, assume a line is complete if it ends with a semicolon or a closing brace.
        const trimmed = line.trim();
        return trimmed.endsWith(";") || trimmed.endsWith("}") || trimmed === "";
        }

        // A function that builds a prompt and calls your auto-completion API.
        // Here we simulate an auto-complete call using your model.
        async function triggerAutoComplete(lineContent) {
        // Build a prompt that tells the model to complete this line.
        // You can add context from surrounding lines if needed.
        const prompt = `Complete the following line of code:\n${lineContent}`;
        try {
            // Here we assume you have a function similar to callAICodeAssistant,
            // but for auto-completion. You might reuse callAICodeAssistant if it fits.
            const completionResponse = await callAICodeAssistant(prompt);
            // Process the response as needed. For example, extract the suggestion.
            return completionResponse;
        } catch (error) {
            console.error("Auto-complete error:", error);
            return null;
        }
        }

      sourceEditor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        run
      );
    });

    layout.registerComponent("stdin", function (container, state) {
      stdinEditor = monaco.editor.create(container.getElement()[0], {
        automaticLayout: true,
        scrollBeyondLastLine: false,
        readOnly: state.readOnly,
        language: "plaintext",
        fontFamily: "JetBrains Mono",
        minimap: {
          enabled: false,
        },
      });
    });

    layout.registerComponent("aiAssistant", function (container, state) {
      const aiContainer = document.createElement("div");
      aiContainer.className = "ai-assistant-container";
      aiContainer.innerHTML = `
          <div class="ai-assistant-container">
            <div id="ai-output" class="ai-assistant-output"></div>
            <div class="ai-assistant-input-container">
              <textarea id="ai-input" class="ai-assistant-input" placeholder="Ask something..."></textarea>
              <button id="ai-send-btn" class="ai-assistant-btn">Send</button>
            </div>
          </div>
        `;

      container.getElement()[0].appendChild(aiContainer);

      const aiInput = aiContainer.querySelector("#ai-input");
      const aiOutput = aiContainer.querySelector("#ai-output");
      const aiButton = aiContainer.querySelector("#ai-send-btn");

      // Add loading state
      let isLoading = false;

      aiButton.addEventListener("click", async function () {
        if (isLoading) return;

        const query = aiInput.value.trim();
        if (!query) return;

        try {
          isLoading = true;
          aiButton.disabled = true;
          aiInput.disabled = true;

          // Add user message to UI
          aiOutput.innerHTML += `<div class="user-query">You: ${query}</div>`;

          // Get and display AI response
          const response = await callAICodeAssistant(query);
          if (!response || !response.trim()) {
            aiOutput.innerHTML += `<div class="ai-response">AI: Ok, I have made the appropriate changes.</div>`;
          } else {
            aiOutput.innerHTML += `<div class="ai-response">AI: ${response}</div>`;
          }
          // Clear input and scroll to bottom
          aiInput.value = "";
          aiOutput.scrollTop = aiOutput.scrollHeight;
        } catch (error) {
          console.error("AI Error:", error);
          aiOutput.innerHTML += `<div class="error">Error: ${error.message}</div>`;
        } finally {
          isLoading = false;
          aiButton.disabled = false;
          aiInput.disabled = false;
        }
      });
    });

    layout.registerComponent("stdout", function (container, state) {
      stdoutEditor = monaco.editor.create(container.getElement()[0], {
        automaticLayout: true,
        scrollBeyondLastLine: false,
        readOnly: state.readOnly,
        language: "plaintext",
        fontFamily: "JetBrains Mono",
        minimap: {
          enabled: false,
        },
      });
    });

    layout.on("initialised", function () {
      setDefaults();
      refreshLayoutSize();
      window.top.postMessage({ event: "initialised" }, "*");

      // Now that the source editor is initialized, update the system message.
      // Prepend the system message to the messages array.
      messages.unshift({
        role: "system",
        content:
          "You are an expert coding assistant skilled in both analyzing and improving code. Provide detailed explanations and help users with all programming questions. When asked to modify code, always return the complete updated code enclosed within triple backticks (```), and do not include triple backticks elsewhere in your response. " +
          "If you decide that the code should be changed to a different programming language, prepend your response with a language change marker formatted exactly as follows: @@@<language_key>@@@. Use one of the following keys for the corresponding languages:\n\n" +
          "  - C: c\n" +
          "  - C++: cpp\n" +
          "  - C#: csharp\n" +
          "  - Java: java\n" +
          "  - JavaScript: javascript\n" +
          "  - Python: python\n" +
          "  - PHP: php\n" +
          "  - Ruby: ruby\n" +
          "  - Go: go\n" +
          "  - Lua: lua\n" +
          "  - Swift: swift\n" +
          "  - TypeScript: typescript\n" +
          "  - Pascal: pascal\n" +
          "\n" +
          "Only include the marker when a language change is desired. Do not use triple backticks for any text other than complete code blocks. The current source code is provided as context:\n\n" +
          sourceEditor.getValue(),
      });
    });

    layout.init();
  });

  let superKey = "⌘";
  if (!/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)) {
    superKey = "Ctrl";
  }

  [$runBtn].forEach((btn) => {
    btn.attr("data-content", `${superKey}${btn.attr("data-content")}`);
  });

  document.querySelectorAll(".description").forEach((e) => {
    e.innerText = `${superKey}${e.innerText}`;
  });

  if (usePuter()) {
    puter.ui.onLaunchedWithItems(async function (items) {
      gPuterFile = items[0];
      openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
    });
  }

  document
    .getElementById("judge0-open-file-btn")
    .addEventListener("click", openAction);
  document
    .getElementById("judge0-save-btn")
    .addEventListener("click", saveAction);

  window.onmessage = function (e) {
    if (!e.data) {
      return;
    }

    if (e.data.action === "get") {
      window.top.postMessage(
        JSON.parse(
          JSON.stringify({
            event: "getResponse",
            source_code: sourceEditor.getValue(),
            language_id: getSelectedLanguageId(),
            flavor: getSelectedLanguageFlavor(),
            stdin: stdinEditor.getValue(),
            stdout: stdoutEditor.getValue(),
            compiler_options: $compilerOptions.val(),
            command_line_arguments: $commandLineArguments.val(),
          })
        ),
        "*"
      );
    } else if (e.data.action === "set") {
      if (e.data.source_code) {
        sourceEditor.setValue(e.data.source_code);
      }
      if (e.data.language_id && e.data.flavor) {
        selectLanguageByFlavorAndId(e.data.language_id, e.data.flavor);
      }
      if (e.data.stdin) {
        stdinEditor.setValue(e.data.stdin);
      }
      if (e.data.stdout) {
        stdoutEditor.setValue(e.data.stdout);
      }
      if (e.data.compiler_options) {
        $compilerOptions.val(e.data.compiler_options);
      }
      if (e.data.command_line_arguments) {
        $commandLineArguments.val(e.data.command_line_arguments);
      }
      if (e.data.api_key) {
        AUTH_HEADERS["Authorization"] = `Bearer ${e.data.api_key}`;
      }
    }
  };
});

const DEFAULT_SOURCE =
  "\
#include <algorithm>\n\
#include <cstdint>\n\
#include <iostream>\n\
#include <limits>\n\
#include <set>\n\
#include <utility>\n\
#include <vector>\n\
\n\
using Vertex    = std::uint16_t;\n\
using Cost      = std::uint16_t;\n\
using Edge      = std::pair< Vertex, Cost >;\n\
using Graph     = std::vector< std::vector< Edge > >;\n\
using CostTable = std::vector< std::uint64_t >;\n\
\n\
constexpr auto kInfiniteCost{ std::numeric_limits< CostTable::value_type >::max() };\n\
\n\
auto dijkstra( Vertex const start, Vertex const end, Graph const & graph, CostTable & costTable )\n\
{\n\
    std::fill( costTable.begin(), costTable.end(), kInfiniteCost );\n\
    costTable[ start ] = 0;\n\
\n\
    std::set< std::pair< CostTable::value_type, Vertex > > minHeap;\n\
    minHeap.emplace( 0, start );\n\
\n\
    while ( !minHeap.empty() )\n\
    {\n\
        auto const vertexCost{ minHeap.begin()->first  };\n\
        auto const vertex    { minHeap.begin()->second };\n\
\n\
        minHeap.erase( minHeap.begin() );\n\
\n\
        if ( vertex == end )\n\
        {\n\
            break;\n\
        }\n\
\n\
        for ( auto const & neighbourEdge : graph[ vertex ] )\n\
        {\n\
            auto const & neighbour{ neighbourEdge.first };\n\
            auto const & cost{ neighbourEdge.second };\n\
\n\
            if ( costTable[ neighbour ] > vertexCost + cost )\n\
            {\n\
                minHeap.erase( { costTable[ neighbour ], neighbour } );\n\
                costTable[ neighbour ] = vertexCost + cost;\n\
                minHeap.emplace( costTable[ neighbour ], neighbour );\n\
            }\n\
        }\n\
    }\n\
\n\
    return costTable[ end ];\n\
}\n\
\n\
int main()\n\
{\n\
    constexpr std::uint16_t maxVertices{ 10000 };\n\
\n\
    Graph     graph    ( maxVertices );\n\
    CostTable costTable( maxVertices );\n\
\n\
    std::uint16_t testCases;\n\
    std::cin >> testCases;\n\
\n\
    while ( testCases-- > 0 )\n\
    {\n\
        for ( auto i{ 0 }; i < maxVertices; ++i )\n\
        {\n\
            graph[ i ].clear();\n\
        }\n\
\n\
        std::uint16_t numberOfVertices;\n\
        std::uint16_t numberOfEdges;\n\
\n\
        std::cin >> numberOfVertices >> numberOfEdges;\n\
\n\
        for ( auto i{ 0 }; i < numberOfEdges; ++i )\n\
        {\n\
            Vertex from;\n\
            Vertex to;\n\
            Cost   cost;\n\
\n\
            std::cin >> from >> to >> cost;\n\
            graph[ from ].emplace_back( to, cost );\n\
        }\n\
\n\
        Vertex start;\n\
        Vertex end;\n\
\n\
        std::cin >> start >> end;\n\
\n\
        auto const result{ dijkstra( start, end, graph, costTable ) };\n\
\n\
        if ( result == kInfiniteCost )\n\
        {\n\
            std::cout << \"NO\\n\";\n\
        }\n\
        else\n\
        {\n\
            std::cout << result << '\\n';\n\
        }\n\
    }\n\
\n\
    return 0;\n\
}\n\
";

const DEFAULT_STDIN =
  "\
3\n\
3 2\n\
1 2 5\n\
2 3 7\n\
1 3\n\
3 3\n\
1 2 4\n\
1 3 7\n\
2 3 1\n\
1 3\n\
3 1\n\
1 2 4\n\
1 3\n\
";

const DEFAULT_COMPILER_OPTIONS = "";
const DEFAULT_CMD_ARGUMENTS = "";
const DEFAULT_LANGUAGE_ID = 105; // C++ (GCC 14.1.0) (https://ce.judge0.com/languages/105)

function getEditorLanguageMode(languageName) {
  const DEFAULT_EDITOR_LANGUAGE_MODE = "plaintext";
  const LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE = {
    Bash: "shell",
    C: "c",
    C3: "c",
    "C#": "csharp",
    "C++": "cpp",
    Clojure: "clojure",
    "F#": "fsharp",
    Go: "go",
    Java: "java",
    JavaScript: "javascript",
    Kotlin: "kotlin",
    "Objective-C": "objective-c",
    Pascal: "pascal",
    Perl: "perl",
    PHP: "php",
    Python: "python",
    R: "r",
    Ruby: "ruby",
    SQL: "sql",
    Swift: "swift",
    TypeScript: "typescript",
    "Visual Basic": "vb",
  };

  for (let key in LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE) {
    if (languageName.toLowerCase().startsWith(key.toLowerCase())) {
      return LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE[key];
    }
  }
  return DEFAULT_EDITOR_LANGUAGE_MODE;
}

const EXTENSIONS_TABLE = {
  asm: { flavor: CE, language_id: 45 }, // Assembly (NASM 2.14.02)
  c: { flavor: CE, language_id: 103 }, // C (GCC 14.1.0)
  cpp: { flavor: CE, language_id: 105 }, // C++ (GCC 14.1.0)
  cs: { flavor: EXTRA_CE, language_id: 29 }, // C# (.NET Core SDK 7.0.400)
  go: { flavor: CE, language_id: 95 }, // Go (1.18.5)
  java: { flavor: CE, language_id: 91 }, // Java (JDK 17.0.6)
  js: { flavor: CE, language_id: 102 }, // JavaScript (Node.js 22.08.0)
  lua: { flavor: CE, language_id: 64 }, // Lua (5.3.5)
  pas: { flavor: CE, language_id: 67 }, // Pascal (FPC 3.0.4)
  php: { flavor: CE, language_id: 98 }, // PHP (8.3.11)
  py: { flavor: EXTRA_CE, language_id: 25 }, // Python for ML (3.11.2)
  r: { flavor: CE, language_id: 99 }, // R (4.4.1)
  rb: { flavor: CE, language_id: 72 }, // Ruby (2.7.0)
  rs: { flavor: CE, language_id: 73 }, // Rust (1.40.0)
  scala: { flavor: CE, language_id: 81 }, // Scala (2.13.2)
  sh: { flavor: CE, language_id: 46 }, // Bash (5.0.0)
  swift: { flavor: CE, language_id: 83 }, // Swift (5.2.3)
  ts: { flavor: CE, language_id: 101 }, // TypeScript (5.6.2)
  txt: { flavor: CE, language_id: 43 }, // Plain Text
};

function getLanguageForExtension(extension) {
  return EXTENSIONS_TABLE[extension] || { flavor: CE, language_id: 43 }; // Plain Text (https://ce.judge0.com/languages/43)
}

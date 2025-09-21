import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { pipeline, env } from "@xenova/transformers";
import fetch from "node-fetch"; // npm install node-fetch

// ==============================
// Global Env Config
// ==============================
env.allowLocalModels = true;
env.useBrowserCache = false;

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Multer upload
const upload = multer({ dest: "uploads/" });

// ==============================
// Hugging Face API Configuration
// ==============================
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN; // Your token
const YOUR_MODEL_ID = "CodeXRyu/meeting-summarizer";

// Function to call your custom model via Python API
async function summarizeWithCustomModel(text, maxLength = 128, context = null) {
  try {
    const response = await fetch(
      "http://localhost:5001/summarize",
      {
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          text: text,
          context: context,
          max_length: maxLength
        }),
        timeout: 30000 // 30 second timeout
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python API error: ${response.status} - ${errorText}`);
    }

    const apiResult = await response.json();
    
    if (apiResult.error) {
      throw new Error(`Python API error: ${apiResult.error}`);
    }
    
    console.log(`✅ Summary generated using: ${apiResult.model_used}`);
    if (apiResult.fallback_used) {
      console.log("⚠️  Note: Custom model failed, used fallback model");
    }
    
    return {
      summary: apiResult.summary,
      modelUsed: apiResult.model_used,
      fallbackUsed: apiResult.fallback_used || false
    };
  } catch (error) {
    console.error("Python API call failed:", error);
    throw error;
  }
}

// Function to check Python API health
async function checkPythonAPIHealth() {
  try {
    const response = await fetch("http://localhost:5001/health", {
      timeout: 5000 // 5 second timeout
    });
    
    if (response.ok) {
      const healthResult = await response.json();
      console.log("🔍 Python API Health Check:");
      console.log(`   Status: ${healthResult.status}`);
      console.log(`   Primary Model: ${healthResult.primary_model_loaded ? '✅' : '❌'}`);
      console.log(`   Fallback Model: ${healthResult.fallback_model_loaded ? '✅' : '❌'}`);
      console.log(`   Current Model: ${healthResult.current_model}`);
      return healthResult;
    }
    return null;
  } catch (error) {
    console.error("❌ Python API health check failed:", error.message);
    return null;
  }
}

// ==============================
// Fallback to local models for other tasks
// ==============================
let transcriber, fallbackSummarizer, nerModel;

async function loadModels() {
  console.log("Loading models...");

  // Whisper ASR
  transcriber = await pipeline(
    "automatic-speech-recognition",
    "Xenova/whisper-tiny.en"
  );

  // Fallback summarizer (in case Python API fails)
  fallbackSummarizer = await pipeline(
    "summarization",
    "Xenova/distilbart-cnn-12-6"
  );

  // NER Model for entity recognition
  nerModel = await pipeline(
    "token-classification",
    "Xenova/bert-base-NER"
  );

  console.log("✅ Local models loaded (Whisper + DistilBART + NER).");
  
  // Check Python API health
  setTimeout(async () => {
    await checkPythonAPIHealth();
  }, 2000);
}
loadModels();

// ==============================
// Enhanced Summarizer Function
// ==============================
async function generateSummary(text, context = null, useCustomModel = true) {
  let modelUsed = "unknown";
  let fallbackUsed = false;

  try {
    if (useCustomModel) {
      console.log("🔄 Attempting to use custom model via Python API...");
      const customResult = await summarizeWithCustomModel(text, 300, context);
      return {
        summary: customResult.summary,
        modelUsed: customResult.modelUsed,
        fallbackUsed: customResult.fallbackUsed
      };
    }
  } catch (error) {
    console.error("❌ Python API failed, falling back to local Node.js model:", error);
    fallbackUsed = true;
  }

  // Final fallback to local Node.js model
  console.log("🔄 Using local Node.js fallback model...");
  let textForSummary = text;
  if (context) {
    textForSummary = `Meeting Context: ${context}\n\nTranscript: ${text}`;
  }
  
  try {
    const summaryResult = await fallbackSummarizer(textForSummary, {
      max_length: 300,
      min_length: 120,
      num_beams: 4,
      length_penalty: 1.5,
      early_stopping: true,
    });
    
    modelUsed = "Xenova/distilbart-cnn-12-6 (Node.js fallback)";
    
    return {
      summary: summaryResult[0].summary_text,
      modelUsed: modelUsed,
      fallbackUsed: true
    };
  } catch (finalError) {
    console.error("❌ ALL MODELS FAILED:", finalError);
    throw new Error("All summarization models failed. Please check your setup.");
  }
}

// ==============================
// In-Memory Storage (Replace with DB in production)
// ==============================
let meetings = [];
let tasks = [];
let meetingIdCounter = 1;
let taskIdCounter = 1;

// ==============================
// Utility: Clean Transcript
// ==============================
function cleanTranscript(text) {
  return text
    .replace(/\([^)]*\)/g, "") // remove bracketed notes
    .replace(/\s+/g, " ") // normalize spaces
    .replace(/\b(\w+)( \1){2,}\b/gi, "$1") // collapse 3+ repeated words
    .replace(/\b(\w+ \w+)( \1){1,}\b/gi, "$1") // collapse repeated bigrams
    .trim();
}

// ==============================
// Task Extraction Logic
// ==============================
function extractTasksFromText(text) {
  const tasks = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  
  // Task patterns
  const taskPatterns = [
    /(?:will|should|need to|must|have to|going to|plan to|assigned to|responsible for)\s+(.+)/gi,
    /(?:action item|todo|task|assignment):\s*(.+)/gi,
    /(?:follow up|follow-up)\s+(?:with|on)\s+(.+)/gi,
    /(?:schedule|arrange|organize|prepare|complete|finish|deliver|review|update|send|call|email)\s+(.+)/gi,
    /(?:by|before|due)\s+(?:next week|tomorrow|monday|tuesday|wednesday|thursday|friday|end of week|eow)\s*[:-]?\s*(.+)/gi
  ];

  sentences.forEach(sentence => {
    taskPatterns.forEach(pattern => {
      const matches = [...sentence.matchAll(pattern)];
      matches.forEach(match => {
        const taskText = match[1].trim();
        if (taskText.length > 10 && taskText.length < 200) {
          // Extract person if mentioned
          const personMatch = taskText.match(/(?:for|with|to|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
          const person = personMatch ? personMatch[1] : null;
          
          tasks.push({
            id: taskIdCounter++,
            text: taskText,
            assignedTo: person,
            extractedFrom: sentence.trim(),
            status: 'pending',
            createdAt: new Date().toISOString()
          });
        }
      });
    });
  });

  return tasks;
}

// ==============================
// NER Entity Extraction
// ==============================
async function extractEntities(text) {
  try {
    const entities = await nerModel(text);
    
    // Group entities by type
    const groupedEntities = {
      PERSON: [],
      ORG: [],
      LOC: [],
      MISC: []
    };

    entities.forEach(entity => {
      const label = entity.entity.replace('B-', '').replace('I-', '');
      if (groupedEntities[label] && entity.score > 0.7) {
        groupedEntities[label].push({
          text: entity.word,
          confidence: entity.score,
          start: entity.start,
          end: entity.end
        });
      }
    });

    return groupedEntities;
  } catch (error) {
    console.error("NER extraction failed:", error);
    return { PERSON: [], ORG: [], LOC: [], MISC: [] };
  }
}

// ==============================
// Utility: Fallback Summary
// ==============================
function generateFallbackSummary(originalTranscript, cleanedTranscript) {
  if (!originalTranscript || originalTranscript.trim().length < 20) {
    return "The audio is too short. No meaningful conversation detected.";
  }
  if (!cleanedTranscript || cleanedTranscript.length < 10) {
    return "This audio mainly contains background sounds or unclear speech.";
  }
  return null;
}

// ==============================
// Convert to WAV (16kHz mono)
// ==============================
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-ar 16000", "-ac 1", "-f wav"])
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err));
  });
}

// ==============================
// Decode WAV into Float32Array
// ==============================
function readWavAsFloat32Array(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pcmData = buffer.subarray(44); // skip header

  const int16View = new Int16Array(
    pcmData.buffer,
    pcmData.byteOffset,
    pcmData.byteLength / Int16Array.BYTES_PER_ELEMENT
  );

  const float32Data = new Float32Array(int16View.length);
  for (let i = 0; i < int16View.length; i++) {
    float32Data[i] = int16View[i] / 32768;
  }
  return float32Data;
}

// ==============================
// Enhanced Upload Route with Custom Model
// ==============================
app.post("/upload", upload.single("file"), async (req, res) => {
  let filePath, wavPath;
  try {
    filePath = req.file.path;
    wavPath = `${filePath}.wav`;
    const { context, useCustomModel = true } = req.body;

    console.log("Converting to WAV...");
    await convertToWav(filePath, wavPath);

    console.log("Reading WAV as Float32...");
    const audioData = readWavAsFloat32Array(wavPath);

    console.log("Transcribing...");
    const result = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const transcription = result.text.trim();
    const cleanedTranscript = cleanTranscript(transcription);

    // Short/fallback check
    const fallbackMsg = generateFallbackSummary(transcription, cleanedTranscript);
    if (fallbackMsg) {
      return res.json({ transcription, summary: fallbackMsg });
    }

    console.log("Summarizing with custom model...");
    const summaryResult = await generateSummary(cleanedTranscript, context, useCustomModel === "true");

    // Extract entities using NER
    console.log("Extracting entities...");
    const entities = await extractEntities(cleanedTranscript);

    // Extract tasks from transcript and summary
    console.log("Extracting tasks...");
    const extractedTasks = [
      ...extractTasksFromText(cleanedTranscript),
      ...extractTasksFromText(summaryResult.summary)
    ];

    // Remove duplicate tasks
    const uniqueTasks = extractedTasks.filter((task, index, self) => 
      index === self.findIndex(t => t.text.toLowerCase().trim() === task.text.toLowerCase().trim())
    );

    // Store meeting
    const meeting = {
      id: meetingIdCounter++,
      title: context || `Meeting ${new Date().toLocaleDateString()}`,
      transcript: transcription,
      summary: summaryResult.summary,
      entities: entities,
      tasks: uniqueTasks,
      createdAt: new Date().toISOString(),
      context: context,
      modelUsed: summaryResult.modelUsed,
      fallbackUsed: summaryResult.fallbackUsed
    };

    meetings.push(meeting);

    // Add tasks to global tasks list
    uniqueTasks.forEach(task => {
      task.meetingId = meeting.id;
      tasks.push(task);
    });

    res.json({
      transcription,
      summary: summaryResult.summary,
      entities,
      tasks: uniqueTasks,
      meetingId: meeting.id,
      modelUsed: summaryResult.modelUsed,
      fallbackUsed: summaryResult.fallbackUsed
    });
  } catch (err) {
    console.error("Processing failed:", err);
    res.status(500).json({ error: err.message });
  } finally {
    try {
      if (filePath) fs.unlinkSync(filePath);
      if (wavPath) fs.unlinkSync(wavPath);
    } catch {}
  }
});

// ==============================
// Test Route for Custom Model
// ==============================
app.post("/test-summary", express.json(), async (req, res) => {
  try {
    const { text, context, useCustomModel = true } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    const summaryData = await generateSummary(text, context, useCustomModel);
    
    // Extract entities and tasks for testing
    const entities = await extractEntities(text);
    const extractedTasks = extractTasksFromText(text);

    res.json({
      original_text: text,
      summary: summaryData.summary,
      entities,
      tasks: extractedTasks,
      modelUsed: summaryData.modelUsed,
      fallbackUsed: summaryData.fallbackUsed
    });
  } catch (err) {
    console.error("Summary test failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// API Routes for Data Management (unchanged)
// ==============================

// Get all meetings
app.get("/meetings", (req, res) => {
  res.json(meetings);
});

// Get specific meeting
app.get("/meetings/:id", (req, res) => {
  const meeting = meetings.find(m => m.id === parseInt(req.params.id));
  if (!meeting) {
    return res.status(404).json({ error: "Meeting not found" });
  }
  res.json(meeting);
});

// Get all tasks
app.get("/tasks", (req, res) => {
  res.json(tasks);
});

// Update task status
app.patch("/tasks/:id", (req, res) => {
  const taskId = parseInt(req.params.id);
  const { status, assignedTo } = req.body;
  
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (status) task.status = status;
  if (assignedTo !== undefined) task.assignedTo = assignedTo;
  task.updatedAt = new Date().toISOString();

  res.json(task);
});

// Delete task
app.delete("/tasks/:id", (req, res) => {
  const taskId = parseInt(req.params.id);
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found" });
  }

  tasks.splice(taskIndex, 1);
  res.json({ message: "Task deleted successfully" });
});

// Delete meeting
app.delete("/meetings/:id", (req, res) => {
  const meetingId = parseInt(req.params.id);
  const meetingIndex = meetings.findIndex(m => m.id === meetingId);
  
  if (meetingIndex === -1) {
    return res.status(404).json({ error: "Meeting not found" });
  }

  // Remove associated tasks
  tasks = tasks.filter(t => t.meetingId !== meetingId);
  
  meetings.splice(meetingIndex, 1);
  res.json({ message: "Meeting and associated tasks deleted successfully" });
});

// ==============================
// Start Server
// ==============================
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log(`🤖 Using custom model via Python API at: http://localhost:5001`);
  console.log(`📝 Test custom model at: POST /test-summary`);
  console.log(`📋 API Endpoints:`);
  console.log(`   POST /upload - Upload audio (use useCustomModel=true in body)`);
  console.log(`   POST /test-summary - Test summarization`);
  console.log(`   GET /meetings - Get all meetings`);
  console.log(`   GET /meetings/:id - Get specific meeting`);
  console.log(`   GET /tasks - Get all tasks`);
  console.log(`   PATCH /tasks/:id - Update task`);
  console.log(`   DELETE /tasks/:id - Delete task`);
  console.log(`   DELETE /meetings/:id - Delete meeting`);
  console.log(`\n⚠️  Make sure to run the Python API first: python python_model_api.py`);
});
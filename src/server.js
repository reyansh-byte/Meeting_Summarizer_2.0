import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { pipeline, env } from "@xenova/transformers";
import fetch from "node-fetch";

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
// Enhanced Transcript Processing
// ==============================
function parseTranscript(transcript) {
  // Handle both line breaks and sentence-based parsing
  const text = transcript.replace(/\n/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
  
  const speakers = new Set();
  const segments = [];
  
  sentences.forEach(sentence => {
    // More flexible speaker pattern matching
    const speakerPatterns = [
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)[,:]\s*(.+)$/,  // "John Smith:" or "John Smith,"
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[,-]\s*(.+)$/  // "John Smith -" or "John Smith -"
    ];
    
    let matched = false;
    for (const pattern of speakerPatterns) {
      const match = sentence.match(pattern);
      if (match) {
        const speaker = match[1].trim();
        const content = match[2].trim();
        
        // Filter out common false positives
        if (!['Good', 'Thanks', 'Yes', 'No', 'Okay', 'Well'].includes(speaker)) {
          speakers.add(speaker);
          segments.push({ speaker, content });
          matched = true;
          break;
        }
      }
    }
    
    if (!matched && sentence.trim()) {
      segments.push({ speaker: null, content: sentence.trim() });
    }
  });
  
  return { speakers: Array.from(speakers), segments };
}

function extractKeyTopics(segments) {
  const topics = new Set();
  const topicKeywords = [
    'launch', 'release', 'deployment', 'development', 'testing', 'marketing',
    'campaign', 'sales', 'training', 'integration', 'payment', 'performance',
    'security', 'app store', 'mobile app', 'website', 'documentation'
  ];
  
  segments.forEach(segment => {
    const content = segment.content.toLowerCase();
    topicKeywords.forEach(keyword => {
      if (content.includes(keyword)) {
        topics.add(keyword);
      }
    });
  });
  
  return Array.from(topics);
}

// ==============================
// Enhanced Entity Extraction with Better NER
// ==============================
async function extractEntities(text) {
  try {
    const entities = await nerModel(text);
    
    const groupedEntities = {
      PERSON: [],
      ORG: [],
      LOC: [],
      MISC: []
    };

    // Process entities with better filtering
    const processedTokens = [];
    
    entities.forEach(entity => {
      const label = entity.entity.replace('B-', '').replace('I-', '');
      
      // Clean the token (remove ## prefixes from BERT tokenization)
      let cleanToken = entity.word.replace(/^##/, '');
      
      if (groupedEntities[label] && entity.score > 0.6) { // Lower threshold for better recall
        processedTokens.push({
          text: cleanToken,
          label: label,
          confidence: entity.score,
          start: entity.start,
          end: entity.end
        });
      }
    });

    // Merge consecutive tokens for better entity recognition
    const mergedEntities = mergeConsecutiveTokens(processedTokens);
    
    // Group merged entities
    mergedEntities.forEach(entity => {
      if (groupedEntities[entity.label]) {
        // Additional filtering for person names
        if (entity.label === 'PERSON') {
          if (isValidPersonName(entity.text)) {
            groupedEntities[entity.label].push(entity);
          }
        } else {
          groupedEntities[entity.label].push(entity);
        }
      }
    });

    // Fallback: Use rule-based person name extraction if NER fails
    if (groupedEntities.PERSON.length === 0) {
      const ruleBasedPersons = extractPersonNamesRuleBased(text);
      groupedEntities.PERSON = ruleBasedPersons;
    }

    return groupedEntities;
  } catch (error) {
    console.error("NER extraction failed:", error);
    
    // Fallback to rule-based extraction
    return {
      PERSON: extractPersonNamesRuleBased(text),
      ORG: extractOrganizationsRuleBased(text),
      LOC: [],
      MISC: []
    };
  }
}

function mergeConsecutiveTokens(tokens) {
  if (tokens.length === 0) return [];
  
  const merged = [];
  let current = { ...tokens[0] };
  
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    
    // If same label and positions are close, merge
    if (token.label === current.label && 
        token.start <= current.end + 2) {
      current.text += token.text;
      current.end = token.end;
      current.confidence = Math.max(current.confidence, token.confidence);
    } else {
      merged.push(current);
      current = { ...token };
    }
  }
  
  merged.push(current);
  return merged;
}

function isValidPersonName(name) {
  // Filter out common false positives
  const invalidNames = [
    'good', 'thanks', 'yes', 'no', 'okay', 'well', 'sure', 'right',
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'today', 'tomorrow', 'yesterday', 'next', 'last', 'this', 'that',
    'meeting', 'call', 'project', 'team', 'company', 'business'
  ];
  
  const cleanName = name.toLowerCase().trim();
  
  // Must be at least 2 characters
  if (cleanName.length < 2) return false;
  
  // Must not be in invalid names list
  if (invalidNames.includes(cleanName)) return false;
  
  // Must start with capital letter (in original)
  if (!/^[A-Z]/.test(name.trim())) return false;
  
  // Must contain only letters and spaces
  if (!/^[A-Za-z\s]+$/.test(name.trim())) return false;
  
  return true;
}

function extractPersonNamesRuleBased(text) {
  const personNames = new Set();
  
  // Pattern 1: Names followed by colon or said/mentioned
  const speakerPatterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[:\s](?:said|mentioned|stated|discussed|noted)/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?):/g
  ];
  
  speakerPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (isValidPersonName(name)) {
        personNames.add(name);
      }
    }
  });
  
  // Pattern 2: Common name patterns
  const namePattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g;
  let match;
  while ((match = namePattern.exec(text)) !== null) {
    const name = match[1].trim();
    if (isValidPersonName(name) && name.split(' ').length === 2) {
      personNames.add(name);
    }
  }
  
  return Array.from(personNames).map(name => ({
    text: name,
    confidence: 0.8,
    start: 0,
    end: 0
  }));
}

function extractOrganizationsRuleBased(text) {
  const orgNames = new Set();
  
  // Common organization patterns
  const orgPatterns = [
    /\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)\s+(?:Inc|Corp|LLC|Ltd|Company|Technologies|Solutions|Systems)\b/g,
    /\b(?:at|with|for)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)\b/g
  ];
  
  orgPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const org = match[1].trim();
      if (org.length > 2 && !isValidPersonName(org)) {
        orgNames.add(org);
      }
    }
  });
  
  return Array.from(orgNames).map(org => ({
    text: org,
    confidence: 0.7,
    start: 0,
    end: 0
  }));
}

// ==============================
// Enhanced Task Extraction with Better Person Recognition
// ==============================
function extractTasksFromText(text) {
  const tasks = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  
  // Enhanced task patterns
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
          
          // Enhanced person extraction with better filtering
          const person = extractPersonFromTask(sentence, taskText);
          
          // Extract deadline if present
          const deadline = extractDeadlineFromTask(sentence);
          
          tasks.push({
            id: taskIdCounter++,
            text: taskText,
            assignedTo: person,
            deadline: deadline,
            priority: determinePriority(taskText),
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

function extractPersonFromTask(sentence, taskText) {
  // Month names and common false positives to exclude
  const excludeList = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'next', 'last', 'this', 'that', 'week', 'month', 'year',
    'today', 'tomorrow', 'yesterday', 'morning', 'afternoon', 'evening'
  ];
  
  // Enhanced person patterns
  const personPatterns = [
    /(?:for|with|to|by|assigned to|ask)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:will|should|needs? to|must|has to)/gi,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:is|was)\s+(?:responsible|assigned)/gi
  ];
  
  // Try to find person in the full sentence first
  for (const pattern of personPatterns) {
    pattern.lastIndex = 0; // Reset regex
    const match = pattern.exec(sentence);
    if (match) {
      const potentialPerson = match[1].trim();
      if (isValidTaskPerson(potentialPerson, excludeList)) {
        return potentialPerson;
      }
    }
  }
  
  // Fallback: look for any capitalized word that could be a name
  const words = sentence.split(/\s+/);
  for (const word of words) {
    if (/^[A-Z][a-z]+$/.test(word) && isValidTaskPerson(word, excludeList)) {
      return word;
    }
  }
  
  return null;
}

function isValidTaskPerson(name, excludeList) {
  const lowerName = name.toLowerCase();
  
  // Must not be in exclude list
  if (excludeList.includes(lowerName)) return false;
  
  // Must be at least 2 characters
  if (name.length < 2) return false;
  
  // Must not be common task-related words
  const taskWords = ['task', 'item', 'action', 'todo', 'meeting', 'project', 'team', 'work', 'job'];
  if (taskWords.includes(lowerName)) return false;
  
  // Must start with capital letter
  if (!/^[A-Z]/.test(name)) return false;
  
  return true;
}

function extractDeadlineFromTask(sentence) {
  const deadlinePatterns = [
    /(?:by|before|due|deadline)\s+((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month))/gi,
    /(?:by|before|due|deadline)\s+((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2})/gi,
    /(?:by|before|due|deadline)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/gi,
    /((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?)/gi
  ];
  
  for (const pattern of deadlinePatterns) {
    const match = sentence.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  
  return null;
}

function determinePriority(taskText) {
  const highPriorityKeywords = ['urgent', 'asap', 'immediately', 'critical', 'deadline', 'emergency'];
  const mediumPriorityKeywords = ['important', 'soon', 'priority', 'quickly'];
  
  const text = taskText.toLowerCase();
  
  if (highPriorityKeywords.some(keyword => text.includes(keyword))) {
    return 'high';
  } else if (mediumPriorityKeywords.some(keyword => text.includes(keyword))) {
    return 'medium';
  }
  return 'low';
}

// ==============================
// Enhanced Advanced Task Extraction Function (for generateStructuredSummary)
// ==============================
function extractAdvancedTasks(segments) {
  const tasks = [];
  const allText = segments.map(s => s.content).join(' ');
  
  // Extract tasks from the combined text
  const extractedTasks = extractTasksFromText(allText);
  
  // Also try to extract tasks from individual segments to preserve speaker context
  segments.forEach(segment => {
    if (segment.speaker && segment.content.length > 20) {
      const segmentTasks = extractTasksFromText(segment.content);
      segmentTasks.forEach(task => {
        // If no assignee found, use the speaker as default
        if (!task.assignedTo) {
          task.assignedTo = segment.speaker;
        }
        task.assignee = task.assignedTo; // For backward compatibility
      });
      tasks.push(...segmentTasks);
    }
  });
  
  // Merge with extracted tasks and remove duplicates
  const allTasks = [...extractedTasks, ...tasks];
  const uniqueTasks = allTasks.filter((task, index, self) => 
    index === self.findIndex(t => 
      t.text.toLowerCase().trim() === task.text.toLowerCase().trim()
    )
  );
  
  return uniqueTasks.map(task => ({
    task: task.text,
    assignee: task.assignedTo || task.assignee || 'Unassigned',
    deadline: task.deadline || null,
    priority: task.priority || 'low'
  }));
}

// ==============================
// Structured Summary Generator
// ==============================
function generateStructuredSummary(transcript, context = null) {
  const parsed = parseTranscript(transcript);
  const topics = extractKeyTopics(parsed.segments);
  const tasks = extractAdvancedTasks(parsed.segments);
  
  // Create a more natural, paragraph-based summary
  let summary = "";
  
  // Header
  if (context) {
    summary += `Meeting Summary: ${context}\n\n`;
  } else {
    summary += `Meeting Summary\n\n`;
  }
  
  // Overview paragraph
  summary += `This meeting involved `;
  if (parsed.speakers.length > 0) {
    if (parsed.speakers.length === 1) {
      summary += `${parsed.speakers[0]}`;
    } else if (parsed.speakers.length === 2) {
      summary += `${parsed.speakers.join(' and ')}`;
    } else {
      summary += `${parsed.speakers.slice(0, -1).join(', ')}, and ${parsed.speakers[parsed.speakers.length - 1]}`;
    }
  } else {
    summary += `the team`;
  }
  
  if (topics.length > 0) {
    const mainTopics = topics.slice(0, 5);
    summary += ` discussing ${mainTopics.join(', ')}`;
  }
  summary += `.\n\n`;
  
  // Key Discussion Points
  summary += `Key Discussion Points:\n\n`;
  
  // Group content by speaker for better flow
  const speakerContent = {};
  parsed.segments.forEach(segment => {
    if (segment.speaker && segment.content.length > 30) {
      if (!speakerContent[segment.speaker]) {
        speakerContent[segment.speaker] = [];
      }
      speakerContent[segment.speaker].push(segment.content);
    }
  });
  
  // Generate summary paragraphs for each speaker
  Object.entries(speakerContent).forEach(([speaker, contents]) => {
    if (contents.length > 0) {
      const mainPoints = contents.slice(0, 2); // Take first 2 most relevant points
      summary += `${speaker} `;
      if (mainPoints.length === 1) {
        summary += `discussed ${mainPoints[0].toLowerCase()}`;
      } else {
        summary += `covered several key points including ${mainPoints[0].toLowerCase().substring(0, 80)}${mainPoints[0].length > 80 ? '...' : ''}`;
        if (mainPoints[1]) {
          summary += ` and ${mainPoints[1].toLowerCase().substring(0, 60)}${mainPoints[1].length > 60 ? '...' : ''}`;
        }
      }
      summary += `.\n\n`;
    }
  });
  
  // Action Items
  if (tasks.length > 0) {
    summary += `Action Items:\n\n`;
    tasks.forEach((task, index) => {
      summary += `• ${task.assignee}: ${task.task}`;
      if (task.deadline) {
        summary += ` (Due: ${task.deadline})`;
      }
      if (task.priority === 'high') {
        summary += ` [HIGH PRIORITY]`;
      }
      summary += `\n`;
    });
    summary += `\n`;
  }
  
  // Next Steps
  summary += `Next Steps:\n\n`;
  summary += `The team should focus on completing the assigned action items within their specified deadlines. `;
  if (tasks.some(task => task.deadline)) {
    summary += `Key upcoming deadlines should be monitored closely. `;
  }
  summary += `Follow-up meetings may be necessary to track progress and address any blockers.`;
  
  return {
    structuredSummary: summary,
    participants: parsed.speakers,
    topics: topics,
    actionItems: tasks,
    totalSegments: parsed.segments.length
  };
}

// ==============================
// Enhanced Summary Generator (keeping original structure + improvements)
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
    // Enhanced summarization with better structure
    const parsed = parseTranscript(text);
    const topics = extractKeyTopics(parsed.segments);
    
    // Create a better structured summary
    let enhancedSummary = "";
    
    if (context) {
      enhancedSummary += `${context}\n\n`;
    }
    
    // Overview
    enhancedSummary += `Meeting Overview: `;
    if (parsed.speakers.length > 0) {
      enhancedSummary += `This meeting involved ${parsed.speakers.join(', ')} `;
    }
    if (topics.length > 0) {
      enhancedSummary += `discussing key topics including ${topics.slice(0, 5).join(', ')}.`;
    } else {
      enhancedSummary += `discussing various business matters.`;
    }
    enhancedSummary += `\n\n`;
    
    // Key points from each speaker
    const speakerContent = {};
    parsed.segments.forEach(segment => {
      if (segment.speaker && segment.content.length > 30) {
        if (!speakerContent[segment.speaker]) {
          speakerContent[segment.speaker] = [];
        }
        speakerContent[segment.speaker].push(segment.content);
      }
    });
    
    enhancedSummary += `Key Discussion Points:\n`;
    Object.entries(speakerContent).forEach(([speaker, contents]) => {
      if (contents.length > 0) {
        const mainPoint = contents[0].substring(0, 150);
        enhancedSummary += `- ${speaker}: ${mainPoint}${contents[0].length > 150 ? '...' : ''}\n`;
      }
    });
    
    // Use DistilBART for additional AI summary if structured approach doesn't provide enough
    if (enhancedSummary.length < 200) {
      const summaryResult = await fallbackSummarizer(textForSummary, {
          max_length: 800,
          min_length: 400,
          num_beams: 6,
          length_penalty: 0.8,
          early_stopping: true,
          no_repeat_ngram_size: 3,
          repetition_penalty: 1.1 
      });
      enhancedSummary += `\n\nAI Summary: ${summaryResult[0].summary_text}`;
    }
    
    modelUsed = "Enhanced Local Processing + Xenova/distilbart-cnn-12-6";
    
    return {
      summary: enhancedSummary,
      modelUsed: modelUsed,
      fallbackUsed: true
    };
  } catch (finalError) {
    console.error("❌ ALL MODELS FAILED:", finalError);
    throw new Error("All summarization models failed. Please check your setup.");
  }
}

// ==============================
// Keep your existing functions
// ==============================
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN;

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
        timeout: 30000
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

async function checkPythonAPIHealth() {
  try {
    const response = await fetch("http://localhost:5001/health", {
      timeout: 5000
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
// Load Models
// ==============================
let transcriber, fallbackSummarizer, nerModel;

async function loadModels() {
  console.log("Loading models...");

  transcriber = await pipeline(
    "automatic-speech-recognition",
    "Xenova/whisper-tiny.en"
  );

  fallbackSummarizer = await pipeline(
    "summarization",
    "Xenova/distilbart-cnn-12-6"
  );

  // Use a better NER model for improved person name recognition
  nerModel = await pipeline(
    "token-classification",
    "Xenova/bert-base-multilingual-cased-ner-hrl"
  );

  console.log("✅ Local models loaded (Whisper + DistilBART + Enhanced NER).");
  
  setTimeout(async () => {
    await checkPythonAPIHealth();
  }, 2000);
}
loadModels();

// ==============================
// Storage and Utilities
// ==============================
let meetings = [];
let tasks = [];
let meetingIdCounter = 1;
let taskIdCounter = 1;

function cleanTranscript(text) {
  return text
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(\w+)( \1){2,}\b/gi, "$1")
    .replace(/\b(\w+ \w+)( \1){1,}\b/gi, "$1")
    .trim();
}

function generateFallbackSummary(originalTranscript, cleanedTranscript) {
  if (!originalTranscript || originalTranscript.trim().length < 20) {
    return "The audio is too short. No meaningful conversation detected.";
  }
  if (!cleanedTranscript || cleanedTranscript.length < 10) {
    return "This audio mainly contains background sounds or unclear speech.";
  }
  return null;
}

function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-ar 16000", "-ac 1", "-f wav"])
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err));
  });
}

function readWavAsFloat32Array(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pcmData = buffer.subarray(44);

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
// Enhanced Upload Route
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

    const fallbackMsg = generateFallbackSummary(transcription, cleanedTranscript);
    if (fallbackMsg) {
      return res.json({ transcription, summary: fallbackMsg });
    }

    console.log("Summarizing with enhanced approach...");
    const summaryResult = await generateSummary(cleanedTranscript, context, useCustomModel === "true");

    // Extract entities using NER
    console.log("Extracting entities...");
    const entities = await extractEntities(cleanedTranscript);

    // Extract tasks from transcript and summary (using original method)
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
// Enhanced Test Route
// ==============================
app.post("/test-summary", express.json(), async (req, res) => {
  try {
    const { text, context, useCustomModel = true } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    const summaryData = await generateSummary(text, context, useCustomModel);
    
    // Extract entities and tasks for testing (using original methods)
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
// Keep all your existing API routes
// ==============================
app.get("/meetings", (req, res) => {
  res.json(meetings);
});

app.get("/meetings/:id", (req, res) => {
  const meeting = meetings.find(m => m.id === parseInt(req.params.id));
  if (!meeting) {
    return res.status(404).json({ error: "Meeting not found" });
  }
  res.json(meeting);
});

app.get("/tasks", (req, res) => {
  res.json(tasks);
});

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

app.delete("/tasks/:id", (req, res) => {
  const taskId = parseInt(req.params.id);
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found" });
  }

  tasks.splice(taskIndex, 1);
  res.json({ message: "Task deleted successfully" });
});

app.delete("/meetings/:id", (req, res) => {
  const meetingId = parseInt(req.params.id);
  const meetingIndex = meetings.findIndex(m => m.id === meetingId);
  
  if (meetingIndex === -1) {
    return res.status(404).json({ error: "Meeting not found" });
  }

  tasks = tasks.filter(t => t.meetingId !== meetingId);
  meetings.splice(meetingIndex, 1);
  res.json({ message: "Meeting and associated tasks deleted successfully" });
});

// ==============================
// Start Server
// ==============================
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log(`🤖 Enhanced summarizer with structured output enabled`);
  console.log(`📝 Test enhanced summarizer at: POST /test-summary`);
  console.log(`📋 Key improvements:`);
  console.log(`   • Fixed person name extraction (Alex, Sarah, etc.)`);
  console.log(`   • Months no longer treated as people in task extraction`);
  console.log(`   • Enhanced NER with better filtering and fallback methods`);
  console.log(`   • Advanced task extraction with deadlines and priorities`);
  console.log(`   • Structured meeting summaries with participants, topics, action items`);
  console.log(`   • Hybrid approach combining AI models with rule-based processing`);
  console.log(`   • Better parsing of speaker segments and conversation flow`);
  console.log(`\n⚠️  Make sure to run the Python API for AI summaries: python python_model_api.py`);
});
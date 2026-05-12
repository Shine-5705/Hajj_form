const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
const translate = require("@vitalets/google-translate-api");

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TRIGGER_PHRASE =
  process.env.TRIGGER_PHRASE ||
  "i am sending you the link please fill the details";
const WEBCHAT_FORM_LINK =
  process.env.WEBCHAT_FORM_LINK || `http://localhost:${PORT}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const LLM_VALIDATION_STRICT =
  (process.env.LLM_VALIDATION_STRICT || "true").toLowerCase() === "true";
const LLM_REQUIRED_FOR_ALL_FIELDS =
  (process.env.LLM_REQUIRED_FOR_ALL_FIELDS || "true").toLowerCase() === "true";
const WABA_BASE_URL =
  process.env.WABA_BASE_URL || process.env.BaseURL || process.env.WHATSAPP_BASE_URL || "";
const WABA_API_KEY =
  process.env.WABA_API_KEY || process.env.APIKeys || "";
const WABA_AUTH_HEADER = process.env.WABA_AUTH_HEADER || "Authorization";
const WABA_AUTH_PREFIX = process.env.WABA_AUTH_PREFIX || "";
const FORM_SUBMISSIONS_FILE = path.join(
  __dirname,
  "..",
  "data",
  "form-submissions.json"
);
const sessions = new Map();
const RULE_FALLBACK_ALLOWED_FIELDS = new Set([
  "passportNumber",
  "placeOfIssue",
  "placeOfBirth",
  "surname",
  "givenName",
  "fathersName",
  "mothersName",
  "spousesName",
  "education",
  "occupation",
  "aadhaarNumber",
  "panNumber",
  "dateOfIssue",
  "dateOfExpiry",
  "dateOfBirth",
  "gender",
  "maritalStatus",
  "bloodGroup",
]);

const FORM_FIELDS = [
  {
    key: "passportNumber",
    question:
      "What is your Passport Number? Please enter it exactly as printed (example: A1234567).",
    clarification:
      "Please share your own passport number from your passport booklet. It should look like A1234567 (1 letter + 7 digits).",
    validationHint:
      "Passport number must be 1 capital letter followed by 7 digits (example: A1234567).",
  },
  {
    key: "placeOfIssue",
    question: "What is the Place of Issue on your passport? (City/Country)",
    clarification:
      "Please share the place written in your passport under 'Place of Issue' (usually city/country of issuing authority).",
    validationHint: "Please enter a valid place name (letters and spaces only).",
  },
  {
    key: "dateOfIssue",
    question:
      "What is your Passport Date of Issue? (Accepted: DD/MM/YYYY or YYYY-MM-DD)",
    clarification:
      "I need the Date of Issue printed on your passport (the date your passport was issued), not someone else's date.",
    validationHint: "Please provide a valid date in DD/MM/YYYY or YYYY-MM-DD format.",
  },
  {
    key: "dateOfExpiry",
    question:
      "What is your Passport Date of Expiry? (Accepted: DD/MM/YYYY or YYYY-MM-DD)",
    clarification:
      "I need the Expiry Date printed on your passport (the date your passport expires).",
    validationHint: "Please provide a valid date in DD/MM/YYYY or YYYY-MM-DD format.",
  },
  {
    key: "dateOfBirth",
    question:
      "What is your Date of Birth as per passport? (Accepted: DD/MM/YYYY or YYYY-MM-DD)",
    clarification:
      "Please share your own date of birth exactly as printed in your passport.",
    validationHint: "Please provide a valid date in DD/MM/YYYY or YYYY-MM-DD format.",
  },
  {
    key: "placeOfBirth",
    question: "What is your Place of Birth? (City/Country)",
    validationHint: "Please enter a valid place name (letters and spaces only).",
  },
  {
    key: "surname",
    question: "What is your Surname (Last Name) exactly as in passport?",
    validationHint: "Please provide surname using letters only.",
  },
  {
    key: "givenName",
    question: "What is your Given Name (First Name) exactly as in passport?",
    validationHint: "Please provide given name using letters only.",
  },
  {
    key: "fathersName",
    question: "What is your Father's Name?",
    validationHint: "Please provide a valid name (letters and spaces only).",
  },
  {
    key: "mothersName",
    question: "What is your Mother's Name?",
    validationHint: "Please provide a valid name (letters and spaces only).",
  },
  {
    key: "spousesName",
    question: "What is your Spouse's Name? (Type 'skip' if not applicable)",
    validationHint:
      "Please provide a valid spouse name, or type 'skip' if not applicable.",
  },
  {
    key: "gender",
    question: "What is your Gender? (Male / Female / Other)",
    validationHint: "Please answer only with Male, Female, or Other.",
  },
  {
    key: "maritalStatus",
    question:
      "What is your Marital Status? (Single / Married / Divorced / Widowed / Separated)",
    validationHint:
      "Please answer with one of: Single, Married, Divorced, Widowed, Separated.",
  },
  {
    key: "bloodGroup",
    question: "What is your Blood Group? (example: A+, O-, AB+)",
    validationHint: "Please provide a valid blood group like A+, A-, B+, B-, AB+, AB-, O+, O-.",
  },
  {
    key: "education",
    question: "What is your Educational Qualification? (example: Graduate, Diploma)",
    validationHint: "Please provide your educational qualification in text.",
  },
  {
    key: "occupation",
    question: "What is your Occupation? (example: Engineer, Business, Student)",
    validationHint: "Please provide a valid occupation in text.",
  },
  {
    key: "aadhaarNumber",
    question:
      "What is your Aadhaar Number? (Optional, if available. Enter 12 digits or type 'skip')",
    validationHint: "Aadhaar must be exactly 12 digits, or type 'skip'.",
    optional: true,
  },
  {
    key: "panNumber",
    question: "What is your PAN Number? (Optional. Format example: ABCDE1234F or type 'skip')",
    validationHint: "PAN format must be 5 letters + 4 digits + 1 letter (example: ABCDE1234F).",
    optional: true,
  },
];

const DEFER_SUPPORT_MESSAGE =
  "Please complete the form first. If you have any query, our support team will contact you.";
const GREETING_MESSAGE =
  "Thank you for your interest in Hajj. I will ask a few questions one by one. Please answer only the current question.";
const WHATSAPP_LINK_MESSAGE =
  "Please fill your Hajj details using this secure form link:";
const AGENT_SYSTEM_PROMPT = `You are a strict Hajj form assistant. 
Rules:
1) Ask one question at a time and only for the current field.
2) Understand user intent and classify as answer / invalid / off_topic / clarification / unknown.
3) For clarification, explain the current field briefly and ask the same question again.
4) Never move to next question unless current answer is valid.
5) Keep extracted value clean and concise.
6) If user asks unrelated question, ask them to complete form first.
7) Respect required format validations for passport, dates, PAN, Aadhaar, blood group, gender, and marital status.`;

const INDIAN_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "ta", label: "Tamil" },
  { code: "ur", label: "Urdu" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "or", label: "Odia" },
  { code: "as", label: "Assamese" },
];

const LANGUAGE_SELECTION_MESSAGE = `Please choose your preferred language for this conversation.
Available languages: English, Hindi, Bengali, Telugu, Marathi, Tamil, Urdu, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese.
Type your preferred language name.`;
const HINDI_STATIC_TRANSLATIONS = {
  [GREETING_MESSAGE]:
    "हज में आपकी रुचि के लिए धन्यवाद। मैं आपसे एक-एक करके कुछ प्रश्न पूछूंगा। कृपया केवल वर्तमान प्रश्न का उत्तर दें।",
  [LANGUAGE_SELECTION_MESSAGE]:
    "कृपया इस बातचीत के लिए अपनी पसंदीदा भाषा चुनें।\nउपलब्ध भाषाएं: अंग्रेज़ी, हिंदी, बांग्ला, तेलुगु, मराठी, तमिल, उर्दू, गुजराती, कन्नड़, मलयालम, पंजाबी, ओडिया, असमिया।\nअपनी पसंदीदा भाषा का नाम लिखें।",
  [DEFER_SUPPORT_MESSAGE]:
    "कृपया पहले फॉर्म पूरा करें। यदि कोई प्रश्न है, तो हमारी सपोर्ट टीम आपसे संपर्क करेगी।",
  "Great, we will continue in Hindi.": "बहुत अच्छा, अब हम हिंदी में बातचीत जारी रखेंगे।",
  "Your form is already completed. If you need help, our support team will contact you.":
    "आपका फॉर्म पहले ही पूरा हो चुका है। यदि आपको सहायता चाहिए, तो हमारी सपोर्ट टीम आपसे संपर्क करेगी।",
  "Thank you. Your Hajj form details have been captured successfully. Our support team will contact you if any clarification is needed.":
    "धन्यवाद। आपके हज फॉर्म का विवरण सफलतापूर्वक दर्ज हो गया है। यदि किसी स्पष्टीकरण की जरूरत होगी, तो हमारी सपोर्ट टीम आपसे संपर्क करेगी।",
  "Please answer the current question based on your own passport/document details.":
    "कृपया अपने पासपोर्ट/दस्तावेज़ के अनुसार वर्तमान प्रश्न का उत्तर दें।",
  "Please answer the current field as shown on your document.":
    "कृपया दस्तावेज़ में जैसा दिया है, उसी अनुसार इस फ़ील्ड का उत्तर दें।",
  "Please provide a valid answer in the required format.":
    "कृपया आवश्यक प्रारूप में सही उत्तर दें।",
  "No worries, let's move forward. Let me know once you find that out.":
    "कोई बात नहीं, हम आगे बढ़ते हैं। जब यह जानकारी मिल जाए तो जरूर बताइए।",
};

const HINDI_FIELD_TRANSLATIONS = {
  passportNumber:
    "आपका पासपोर्ट नंबर क्या है? कृपया जैसा पासपोर्ट में लिखा है वैसा ही लिखें (उदाहरण: A1234567)।",
  placeOfIssue: "आपके पासपोर्ट में जारी करने का स्थान क्या लिखा है? (शहर/देश)",
  dateOfIssue:
    "आपके पासपोर्ट की जारी करने की तारीख क्या है? (स्वीकृत प्रारूप: DD/MM/YYYY या YYYY-MM-DD)",
  dateOfExpiry:
    "आपके पासपोर्ट की समाप्ति तारीख क्या है? (स्वीकृत प्रारूप: DD/MM/YYYY या YYYY-MM-DD)",
  dateOfBirth:
    "पासपोर्ट के अनुसार आपकी जन्मतिथि क्या है? (स्वीकृत प्रारूप: DD/MM/YYYY या YYYY-MM-DD)",
  placeOfBirth: "आपका जन्म स्थान क्या है? (शहर/देश)",
  surname: "पासपोर्ट के अनुसार आपका उपनाम (सरनेम) क्या है?",
  givenName: "पासपोर्ट के अनुसार आपका दिया गया नाम (पहला नाम) क्या है?",
  fathersName: "आपके पिता का पूरा नाम क्या है?",
  mothersName: "आपकी माता का पूरा नाम क्या है?",
  spousesName: "आपके जीवनसाथी का नाम क्या है? (यदि लागू नहीं है तो 'skip' लिखें)",
  gender: "आपका लिंग क्या है? (पुरुष / महिला / अन्य)",
  maritalStatus:
    "आपकी वैवाहिक स्थिति क्या है? (अविवाहित / विवाहित / तलाकशुदा / विधवा/विधुर / अलग रह रहे)",
  bloodGroup: "आपका रक्त समूह क्या है? (उदाहरण: A+, O-, AB+)",
  education: "आपकी शैक्षणिक योग्यता क्या है? (उदाहरण: Graduate, Diploma)",
  occupation: "आपका पेशा क्या है? (उदाहरण: Engineer, Business, Student)",
  aadhaarNumber:
    "आपका Aadhaar Number क्या है? (वैकल्पिक। 12 अंक लिखें या 'skip' लिखें)",
  panNumber:
    "आपका पैन नंबर क्या है? (वैकल्पिक। उदाहरण: ABCDE1234F या 'skip' लिखें)",
};

const HINDI_VALIDATION_HINTS = {
  passportNumber:
    "पासपोर्ट नंबर का सही प्रारूप 1 बड़ा अक्षर + 7 अंक है (उदाहरण: A1234567)।",
  placeOfIssue: "कृपया जारी करने का सही स्थान लिखें (केवल अक्षर और स्पेस)।",
  dateOfIssue:
    "कृपया सही तारीख लिखें। स्वीकार्य प्रारूप: DD/MM/YYYY या YYYY-MM-DD।",
  dateOfExpiry:
    "कृपया सही तारीख लिखें। स्वीकार्य प्रारूप: DD/MM/YYYY या YYYY-MM-DD।",
  dateOfBirth:
    "कृपया सही तारीख लिखें। स्वीकार्य प्रारूप: DD/MM/YYYY या YYYY-MM-DD।",
  placeOfBirth: "कृपया जन्म स्थान सही लिखें (केवल अक्षर और स्पेस)।",
  surname: "कृपया उपनाम सही लिखें (केवल अक्षर)।",
  givenName: "कृपया दिया गया नाम सही लिखें (केवल अक्षर)।",
  fathersName: "कृपया पिता का नाम सही लिखें (केवल अक्षर और स्पेस)।",
  mothersName: "कृपया माता का नाम सही लिखें (केवल अक्षर और स्पेस)।",
  spousesName: "कृपया जीवनसाथी का नाम लिखें, या लागू न होने पर 'skip' लिखें।",
  gender: "कृपया केवल पुरुष, महिला, या अन्य में से एक लिखें।",
  maritalStatus:
    "कृपया इनमें से एक लिखें: अविवाहित, विवाहित, तलाकशुदा, विधवा/विधुर, अलग रह रहे।",
  bloodGroup:
    "कृपया सही रक्त समूह लिखें: A+, A-, B+, B-, AB+, AB-, O+, O-।",
  education: "कृपया अपनी शैक्षणिक योग्यता स्पष्ट रूप से लिखें।",
  occupation: "कृपया अपना व्यवसाय/पेशा स्पष्ट रूप से लिखें।",
  aadhaarNumber: "आधार नंबर 12 अंकों का होना चाहिए, या 'skip' लिखें।",
  panNumber:
    "PAN प्रारूप 5 अक्षर + 4 अंक + 1 अक्षर होना चाहिए (उदाहरण: ABCDE1234F)।",
};

const HINDI_CLARIFICATIONS = {
  passportNumber:
    "कृपया अपना पासपोर्ट नंबर पासपोर्ट बुकलेट से देखकर लिखें। इसका प्रारूप A1234567 जैसा होना चाहिए।",
  placeOfIssue:
    "कृपया पासपोर्ट में 'जारी करने का स्थान' जैसा लिखा है वही लिखें (आमतौर पर शहर/देश)।",
  dateOfIssue:
    "कृपया पासपोर्ट पर छपी जारी करने की तारीख लिखें, आज की तारीख नहीं।",
  dateOfExpiry:
    "कृपया पासपोर्ट पर छपी समाप्ति तारीख लिखें।",
  dateOfBirth:
    "कृपया पासपोर्ट में छपी अपनी जन्मतिथि लिखें।",
};

async function saveFormSubmission({
  sessionKey,
  channel,
  preferredLanguageCode,
  preferredLanguageLabel,
  answers,
}) {
  const submission = {
    id: crypto.randomUUID(),
    sessionKey,
    channel,
    preferredLanguageCode,
    preferredLanguageLabel,
    answers,
    submittedAt: new Date().toISOString(),
  };

  const dirPath = path.dirname(FORM_SUBMISSIONS_FILE);
  await fs.mkdir(dirPath, { recursive: true });

  let existing = [];
  try {
    const fileContent = await fs.readFile(FORM_SUBMISSIONS_FILE, "utf8");
    existing = JSON.parse(fileContent);
    if (!Array.isArray(existing)) {
      existing = [];
    }
  } catch (_error) {
    existing = [];
  }

  existing.push(submission);
  await fs.writeFile(
    FORM_SUBMISSIONS_FILE,
    JSON.stringify(existing, null, 2),
    "utf8"
  );

  return submission;
}

function normalizeText(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLanguageByCode(code) {
  return INDIAN_LANGUAGES.find((language) => language.code === code);
}

function getHindiFallbackTranslation(text) {
  if (HINDI_STATIC_TRANSLATIONS[text]) {
    return HINDI_STATIC_TRANSLATIONS[text];
  }

  const field = FORM_FIELDS.find((item) => item.question === text);
  if (field && HINDI_FIELD_TRANSLATIONS[field.key]) {
    return HINDI_FIELD_TRANSLATIONS[field.key];
  }

  return text;
}

async function googleTranslate(text, target, source) {
  if (!text || !target) {
    return text;
  }

  try {
    const translatedResult = await translate(text, {
      to: target,
      ...(source ? { from: source } : {}),
    });
    const translated = translatedResult?.text || text;
    if (target === "hi" && translated === text) {
      return getHindiFallbackTranslation(text);
    }
    return translated;
  } catch (_error) {
    if (target === "hi") {
      return getHindiFallbackTranslation(text);
    }
    return text;
  }
}

async function detectLanguageFromGoogle(text) {
  if (!text) {
    return "";
  }

  try {
    const detectedResult = await translate(text, { to: "en" });
    return detectedResult?.from?.language?.iso || "";
  } catch (_error) {
    return "";
  }
}

async function localizeMessageForSession(session, text) {
  if (!session?.preferredLanguageCode || session.preferredLanguageCode === "en") {
    return text;
  }
  return googleTranslate(text, session.preferredLanguageCode, "en");
}

async function normalizeUserInputForSession(session, inputText) {
  if (!session?.preferredLanguageCode || session.preferredLanguageCode === "en") {
    return inputText;
  }
  return googleTranslate(inputText, "en", session.preferredLanguageCode);
}

async function resolvePreferredLanguage(inputText) {
  const normalizedInput = normalizeText(inputText);
  if (!normalizedInput) {
    return null;
  }

  const languageAliases = {
    english: "en",
    eng: "en",
    hindi: "hi",
    bengali: "bn",
    bangla: "bn",
    telugu: "te",
    marathi: "mr",
    tamil: "ta",
    urdu: "ur",
    gujarati: "gu",
    kannada: "kn",
    malayalam: "ml",
    punjabi: "pa",
    odia: "or",
    oriya: "or",
    assamese: "as",
  };

  const aliasCode = Object.keys(languageAliases).find((alias) =>
    normalizedInput.includes(alias)
  );
  if (aliasCode) {
    const language = getLanguageByCode(languageAliases[aliasCode]);
    if (language) {
      return language;
    }
  }

  const directMatch = INDIAN_LANGUAGES.find((language) =>
    normalizedInput.includes(normalizeText(language.label))
  );
  if (directMatch) {
    return directMatch;
  }

  const detectedCode = await detectLanguageFromGoogle(inputText);
  if (detectedCode) {
    const detectedMatch = getLanguageByCode(detectedCode);
    if (detectedMatch) {
      return detectedMatch;
    }
  }

  return null;
}

function isTriggerMessage(messageText) {
  const normalizedMessage = normalizeText(messageText);
  if (!normalizedMessage) {
    return false;
  }

  return normalizedMessage.includes(normalizeText(TRIGGER_PHRASE));
}

function pickInputText(payload) {
  const inputFields = [
    payload.message,
    payload.text,
    payload.transcript,
    payload.speech,
    payload.speechText,
    payload.voiceText,
  ];

  return inputFields.find(
    (value) => typeof value === "string" && value.trim().length > 0
  );
}

function normalizeNameLikeValue(input) {
  let value = input.trim();
  value = value.replace(
    /^(my|it'?s|its|i am|i'm|this is|name is|my name is)\s+/i,
    ""
  );
  value = value.replace(/^[^\p{L}\p{M}0-9]+/gu, "").trim();
  value = value
    .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value;
}

function isLikelyValidPlace(value) {
  const text = value.trim().toLowerCase();
  if (!/^[\p{L}\p{M}\s.'-]+$/u.test(value) || text.length < 3) {
    return false;
  }

  const compact = text.replace(/[^\p{L}\p{M}]/gu, "");
  if (compact.length < 3) {
    return false;
  }

  const latinOnly = /^[a-z]+$/.test(compact);
  if (latinOnly) {
    const vowels = (compact.match(/[aeiou]/g) || []).length;
    const vowelRatio = vowels / compact.length;
    if (vowels < 2 || vowelRatio < 0.28) {
      return false;
    }
  }

  const words = text.split(/\s+/).filter(Boolean);
  return words.every((word) => word.length >= 2);
}

function extractDateValue(input) {
  const match = input.match(
    /\b(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/
  );
  return match ? match[1] : "";
}

function normalizeDateValue(input) {
  const rawDate = extractDateValue(input);
  if (!rawDate) {
    const monthMap = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      sept: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };

    const normalized = normalizeText(input);
    const dayMonthYear = normalized.match(
      /\b(\d{1,2})(st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})\b/
    );
    const monthDayYear = normalized.match(
      /\b([a-z]+)\s+(\d{1,2})(st|nd|rd|th)?\s*,?\s*(\d{4})\b/
    );

    let day;
    let month;
    let year;

    if (dayMonthYear) {
      day = Number(dayMonthYear[1]);
      month = monthMap[dayMonthYear[3]];
      year = Number(dayMonthYear[4]);
    } else if (monthDayYear) {
      month = monthMap[monthDayYear[1]];
      day = Number(monthDayYear[2]);
      year = Number(monthDayYear[4]);
    } else {
      return "";
    }

    if (!month || !Number.isInteger(day) || !Number.isInteger(year)) {
      return "";
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    const validDate =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;

    if (!validDate) {
      return "";
    }

    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  const parts = rawDate.split(/[/-]/);
  let year;
  let month;
  let day;

  if (parts[0].length === 4) {
    year = Number(parts[0]);
    month = Number(parts[1]);
    day = Number(parts[2]);
  } else {
    day = Number(parts[0]);
    month = Number(parts[1]);
    year = Number(parts[2]);
    if (parts[2].length === 2) {
      year += year >= 50 ? 1900 : 2000;
    }
  }

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!validDate) {
    return "";
  }

  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function extractAlphaNumericToken(input, minLength = 4) {
  const match = input.match(/\b[A-Za-z0-9]{4,20}\b/g);
  if (!match) {
    return "";
  }

  const candidate = match.find((token) => token.length >= minLength);
  return candidate || "";
}

function isUnknownResponse(input) {
  return /^(na|n\/a|none|not available|unknown|i don'?t know|dont know|donno|skip)$/i.test(
    input.trim()
  );
}

function isLikelyOffTopic(input) {
  const normalized = normalizeText(input);
  if (!normalized) {
    return true;
  }

  return (
    input.includes("?") ||
    /^(what|why|how|when|where|can|could|will|do|does|help)\b/.test(normalized)
  );
}

function parseFieldAnswerRuleBased(fieldKey, rawInput) {
  const input = rawInput.trim();
  if (!input) {
    return { ok: false };
  }

  if (isUnknownResponse(input)) {
    return {
      ok: true,
      value: "Not provided",
      note: "No worries, let's move forward. Let me know once you find that out.",
    };
  }

  if (fieldKey === "passportNumber") {
    const token = extractAlphaNumericToken(input, 8).toUpperCase();
    const isValidPassport = /^[A-Z][0-9]{7}$/.test(token);
    return isValidPassport ? { ok: true, value: token } : { ok: false };
  }

  if (fieldKey === "aadhaarNumber") {
    const value = input.replace(/\D/g, "");
    return value.length === 12 ? { ok: true, value } : { ok: false };
  }

  if (fieldKey === "panNumber") {
    const match = input.toUpperCase().match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    return match ? { ok: true, value: match[0] } : { ok: false };
  }

  if (["dateOfIssue", "dateOfExpiry", "dateOfBirth"].includes(fieldKey)) {
    const value = normalizeDateValue(input);
    return value ? { ok: true, value } : { ok: false };
  }

  if (["placeOfIssue", "placeOfBirth"].includes(fieldKey)) {
    const value = normalizeNameLikeValue(input);
    return isLikelyValidPlace(value) ? { ok: true, value } : { ok: false };
  }

  if (fieldKey === "gender") {
    const normalized = normalizeText(input);
    if (
      /\bfemale\b/.test(normalized) ||
      normalized.includes("mahila") ||
      normalized.includes("महिला")
    ) {
      return { ok: true, value: "Female" };
    }
    if (
      /\bmale\b/.test(normalized) ||
      normalized.includes("purush") ||
      normalized.includes("पुरुष")
    ) {
      return { ok: true, value: "Male" };
    }
    if (normalized.includes("other") || normalized.includes("anya") || normalized.includes("अन्य")) {
      return { ok: true, value: "Other" };
    }
    return { ok: false };
  }

  if (fieldKey === "maritalStatus") {
    const options = {
      single: "Single",
      married: "Married",
      divorced: "Divorced",
      widowed: "Widowed",
      separated: "Separated",
      avivahit: "Single",
      अविवाहित: "Single",
      vivahit: "Married",
      विवाहित: "Married",
      talaqshuda: "Divorced",
      तलाकशुदा: "Divorced",
      vidhwa: "Widowed",
      vidhur: "Widowed",
      विधवा: "Widowed",
      विधुर: "Widowed",
      alag: "Separated",
      अलग: "Separated",
    };
    const normalized = normalizeText(input);
    const matchedKey = Object.keys(options).find((key) =>
      normalized.includes(key)
    );
    return matchedKey ? { ok: true, value: options[matchedKey] } : { ok: false };
  }

  if (fieldKey === "bloodGroup") {
    const normalizedBloodGroup = input.toUpperCase().replace(/\s+/g, "");
    const match = normalizedBloodGroup.match(/^(A|B|AB|O)[+-]$/);
    return match ? { ok: true, value: match[0] } : { ok: false };
  }

  const value = normalizeNameLikeValue(input);
  if (!value || value.length < 2) {
    return { ok: false };
  }
  return { ok: true, value };
}

function buildLlmPrompt(fieldKey, question, userInput) {
  const allowedHints = {
    gender: "Male, Female, Other",
    maritalStatus: "Single, Married, Divorced, Widowed, Separated",
    bloodGroup: "A+, A-, B+, B-, AB+, AB-, O+, O-",
  };

  const hintText = allowedHints[fieldKey]
    ? `Allowed normalized values: ${allowedHints[fieldKey]}.\n`
    : "";

  return `You are extracting one field answer for a strict onboarding form.
Current field key: ${fieldKey}
Question asked: ${question}
${hintText}User message: "${userInput}"

Return ONLY valid JSON (no markdown) with this shape:
{
  "status": "answer" | "unknown" | "off_topic" | "invalid" | "clarification",
  "value": "string",
  "reason": "string"
}

Rules:
- "answer": user provided answer for current field. Keep only the value, remove fillers like "my name is".
- "unknown": if user says they do not know / not available / skip.
- "off_topic": if user asks unrelated query/help/question instead of answering.
- "invalid": user attempted answer but unusable for this field.
- "clarification": if user is asking what this field means (even with typos like "whihc place of issue", with or without question mark).
- value must be empty for off_topic.
- value must be empty for clarification.
- For unknown, value should be "Not provided".
- IMPORTANT: For passportNumber, accept only pattern 1 letter + 7 digits (example A1234567). Random letters must be invalid.
- IMPORTANT: For aadhaarNumber, accept only exactly 12 digits.
- IMPORTANT: For panNumber, accept only pattern ABCDE1234F.
- IMPORTANT: For date fields, accept only real dates.
- IMPORTANT: For place/name/education/occupation fields, reject random or meaningless strings (e.g., "mwnas", "asdkj") as invalid.
- IMPORTANT: If user text is gibberish or does not satisfy field format, return invalid.`;
}

function isStructuredAnswerConsistentWithRaw(fieldKey, rawInput, parsedValue) {
  const raw = (rawInput || "").trim();
  const value = (parsedValue || "").trim();
  if (!raw || !value) {
    return false;
  }

  if (fieldKey === "passportNumber" || fieldKey === "panNumber") {
    const rawCompact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return rawCompact.includes(value.toUpperCase());
  }

  if (fieldKey === "aadhaarNumber") {
    const rawDigits = raw.replace(/\D/g, "");
    return rawDigits.includes(value);
  }

  return true;
}

async function parseFieldAnswerWithLlm(field, rawInput) {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const prompt = buildLlmPrompt(field.key, field.question, rawInput);
  try {
    const response = await axios.post(
      `${OPENAI_BASE_URL}/chat/completions`,
      {
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: AGENT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return null;
    }

    const parsed = JSON.parse(content);
    const status = parsed?.status;
    const value = typeof parsed?.value === "string" ? parsed.value.trim() : "";
    const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";

    if (!["answer", "unknown", "off_topic", "invalid", "clarification"].includes(status)) {
      return null;
    }

    if (status === "unknown") {
      return {
        ok: true,
        value: "Not provided",
        note: "No worries, let's move forward. Let me know once you find that out.",
      };
    }

    if (status === "off_topic") {
      return { ok: false, reason: "off_topic" };
    }

    if (status === "clarification") {
      return { ok: false, reason: "clarification", llmReason: reason };
    }

    if (status === "invalid") {
      return { ok: false, reason: "invalid", llmReason: reason };
    }

    if (status === "answer") {
      const validated = parseFieldAnswerRuleBased(field.key, value || rawInput);
      const consistentWithRaw = isStructuredAnswerConsistentWithRaw(
        field.key,
        rawInput,
        validated.value
      );
      if (!LLM_VALIDATION_STRICT && validated.ok) {
        return validated;
      }

      if (LLM_VALIDATION_STRICT && (!validated.ok || !consistentWithRaw)) {
        return { ok: false, reason: "invalid", llmReason: reason };
      }

      return validated.ok
        ? validated
        : { ok: false, reason: "invalid", llmReason: reason };
    }
  } catch (_error) {
    return null;
  }

  return null;
}

async function parseFieldAnswer(field, rawInput) {
  const ruleParsed = parseFieldAnswerRuleBased(field.key, rawInput);
  if (RULE_FALLBACK_ALLOWED_FIELDS.has(field.key) && ruleParsed.ok) {
    return ruleParsed;
  }

  const llmParsed = await parseFieldAnswerWithLlm(field, rawInput);

  if (llmParsed) {
    if (
      llmParsed.ok === false &&
      RULE_FALLBACK_ALLOWED_FIELDS.has(field.key) &&
      ruleParsed.ok
    ) {
      return ruleParsed;
    }
    return llmParsed;
  }

  if (LLM_REQUIRED_FOR_ALL_FIELDS && !RULE_FALLBACK_ALLOWED_FIELDS.has(field.key)) {
    return {
      ok: false,
      reason: "invalid",
      llmReason:
        "I could not verify your answer right now. Please re-send this answer in the requested format.",
    };
  }

  if (!ruleParsed.ok && isLikelyOffTopic(rawInput)) {
    return { ok: false, reason: "off_topic" };
  }
  if (!ruleParsed.ok) {
    return { ok: false, reason: "invalid" };
  }
  return ruleParsed;
}

function getCurrentField(session) {
  return FORM_FIELDS[session.currentQuestionIndex];
}

function getNextQuestion(session) {
  const field = getCurrentField(session);
  return field ? field.question : "";
}

async function getLocalizedQuestionForSession(session) {
  const field = getCurrentField(session);
  if (!field) {
    return "";
  }
  if (session?.preferredLanguageCode === "hi" && HINDI_FIELD_TRANSLATIONS[field.key]) {
    return HINDI_FIELD_TRANSLATIONS[field.key];
  }
  return localizeMessageForSession(session, field.question);
}

async function getLocalizedValidationHintForSession(session, field, fallbackText) {
  if (session?.preferredLanguageCode === "hi" && field?.key) {
    return (
      HINDI_VALIDATION_HINTS[field.key] ||
      getHindiFallbackTranslation(fallbackText || "") ||
      fallbackText
    );
  }
  return localizeMessageForSession(session, fallbackText);
}

async function getLocalizedClarificationForSession(session, field, fallbackText) {
  if (session?.preferredLanguageCode === "hi" && field?.key) {
    return (
      HINDI_CLARIFICATIONS[field.key] ||
      getHindiFallbackTranslation(fallbackText || "") ||
      fallbackText
    );
  }
  return localizeMessageForSession(session, fallbackText);
}

function isClarificationRequest(input, field) {
  const normalized = normalizeText(input);
  if (!normalized) {
    return false;
  }

  const asksForClarification =
    input.includes("?") &&
    /(\bwhose\b|\bwhich\b|\bwhat\b|\bmean\b|\bexplain\b|\bclarify\b|\bwhat do you mean\b)/.test(
      normalized
    );

  if (asksForClarification) {
    return true;
  }

  if (!field) {
    return false;
  }

  const fieldWords = normalizeText(field.question).split(" ").filter(Boolean);
  const overlapCount = fieldWords.filter(
    (word) => word.length > 3 && normalized.includes(word)
  ).length;

  return input.includes("?") && overlapCount >= 2;
}

function createSession() {
  return {
    awaitingLanguagePreference: true,
    preferredLanguageCode: "en",
    preferredLanguageLabel: "English",
    currentQuestionIndex: 0,
    answers: {},
    startedAt: new Date().toISOString(),
  };
}

function startConversation(sessionKey, reset = false) {
  if (reset || !sessions.has(sessionKey)) {
    sessions.set(sessionKey, createSession());
  }

  return {
    stage: "started",
    currentQuestion: "language_preference",
    reply: `${GREETING_MESSAGE}\n\n${LANGUAGE_SELECTION_MESSAGE}`,
  };
}

async function processConversationAnswer(sessionKey, incomingText) {
  const session = sessions.get(sessionKey);
  if (!session) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        ok: false,
        error: "Session not found. Please start the form first.",
      },
    };
  }

  if (session.awaitingLanguagePreference) {
    const preferredLanguage = await resolvePreferredLanguage(incomingText);
    if (!preferredLanguage) {
      return {
        ok: true,
        payload: {
          ok: true,
          stage: "language_retry",
          reply: LANGUAGE_SELECTION_MESSAGE,
        },
      };
    }

    session.awaitingLanguagePreference = false;
    session.preferredLanguageCode = preferredLanguage.code;
    session.preferredLanguageLabel = preferredLanguage.label;

    const languageAcknowledgement = await localizeMessageForSession(
      session,
      `Great, we will continue in ${preferredLanguage.label}.`
    );
    const firstQuestion = await getLocalizedQuestionForSession(session);

    return {
      ok: true,
      payload: {
        ok: true,
        stage: "language_selected",
        currentLanguage: preferredLanguage.label,
        reply: `${languageAcknowledgement}\n\n${firstQuestion}`,
      },
    };
  }

  const currentField = getCurrentField(session);
  if (!currentField) {
    sessions.delete(sessionKey);
    const localizedCompletedMessage = await localizeMessageForSession(
      session,
      "Your form is already completed. If you need help, our support team will contact you."
    );
    return {
      ok: true,
      payload: {
        ok: true,
        stage: "already_completed",
        reply: localizedCompletedMessage,
      },
    };
  }

  const normalizedIncomingText = await normalizeUserInputForSession(
    session,
    incomingText
  );

  if (isClarificationRequest(normalizedIncomingText, currentField)) {
    const clarificationMessage = await getLocalizedClarificationForSession(
      session,
      currentField,
      currentField.clarification ||
        "Please answer the current question based on your own passport/document details."
    );
    const localizedQuestion = await getLocalizedQuestionForSession(session);
    return {
      ok: true,
      payload: {
        ok: true,
        stage: "clarification",
        field: currentField.key,
        reply: `${clarificationMessage}\n\n${localizedQuestion}`,
      },
    };
  }

  const parsed = await parseFieldAnswer(currentField, normalizedIncomingText);
  if (!parsed.ok) {
    const localizedQuestion = await getLocalizedQuestionForSession(session);
    const localizedOffTopicMessage = await localizeMessageForSession(
      session,
      DEFER_SUPPORT_MESSAGE
    );
    const localizedClarificationMessage = await getLocalizedClarificationForSession(
      session,
      currentField,
      parsed.llmReason ||
        currentField.clarification ||
        "Please answer the current field as shown on your document."
    );
    const localizedInvalidMessage = await getLocalizedValidationHintForSession(
      session,
      currentField,
      parsed.llmReason ||
        currentField.validationHint ||
        "Please provide a valid answer in the required format."
    );

    const invalidOrOffTopicMessage =
      parsed.reason === "off_topic"
        ? `${localizedOffTopicMessage}\n\n${localizedQuestion}`
        : parsed.reason === "clarification"
          ? `${localizedClarificationMessage}\n\n${localizedQuestion}`
          : `${localizedInvalidMessage}\n\n${localizedQuestion}`;

    return {
      ok: true,
      payload: {
        ok: true,
        stage: "retry",
        field: currentField.key,
        reply: invalidOrOffTopicMessage,
      },
    };
  }

  session.answers[currentField.key] = parsed.value;
  session.currentQuestionIndex += 1;

  if (session.currentQuestionIndex >= FORM_FIELDS.length) {
    const completedAnswers = session.answers;
    const channel = sessionKey.startsWith("wa:") ? "whatsapp" : "webchat";
    const savedSubmission = await saveFormSubmission({
      sessionKey,
      channel,
      preferredLanguageCode: session.preferredLanguageCode,
      preferredLanguageLabel: session.preferredLanguageLabel,
      answers: completedAnswers,
    });
    sessions.delete(sessionKey);
    const localizedCompletionMessage = await localizeMessageForSession(
      session,
      "Thank you. Your Hajj form details have been captured successfully. Our support team will contact you if any clarification is needed."
    );

    return {
      ok: true,
      payload: {
        ok: true,
        stage: "completed",
        submissionId: savedSubmission.id,
        answers: completedAnswers,
        reply: localizedCompletionMessage,
      },
    };
  }

  const nextQuestion = await getLocalizedQuestionForSession(session);
  const localizedNote = parsed.note
    ? await localizeMessageForSession(session, parsed.note)
    : "";
  return {
    ok: true,
    payload: {
      ok: true,
      stage: "in_progress",
      nextField: getCurrentField(session).key,
      reply: localizedNote ? `${localizedNote}\n\n${nextQuestion}` : nextQuestion,
    },
  };
}

async function sendWhatsAppMessage(recipientPhone, messageBody) {
  if (WABA_BASE_URL && WABA_API_KEY) {
    const customAuthValue = `${WABA_AUTH_PREFIX}${WABA_API_KEY}`.trim();
    const customHeaders = {
      "Content-Type": "application/json",
      [WABA_AUTH_HEADER]: customAuthValue,
    };

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhone,
      type: "text",
      text: {
        body: messageBody,
      },
    };

    const response = await axios.post(WABA_BASE_URL, body, {
      headers: customHeaders,
    });

    return {
      sent: true,
      provider: "custom_waba",
      providerResponse: response.data,
    };
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    return {
      sent: false,
      reason:
        "WhatsApp credentials missing. Set WABA_BASE_URL and WABA_API_KEY (custom provider) or WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN (Meta Graph).",
    };
  }

  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: recipientPhone,
    type: "text",
    text: {
      body: messageBody,
    },
  };

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  return {
    sent: true,
    provider: "meta_graph",
    providerResponse: response.data,
  };
}

async function safeReply(phone, message) {
  try {
    const whatsappResult = await sendWhatsAppMessage(phone, message);
    return { reply: message, whatsappResult };
  } catch (error) {
    return {
      reply: message,
      whatsappResult: {
        sent: false,
        reason: "Failed to send WhatsApp message.",
        details: error.response?.data || error.message,
      },
    };
  }
}

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.post("/webchat/start", (req, res) => {
  const { sessionId } = req.body || {};
  const sessionKey = `web:${sessionId || crypto.randomUUID()}`;
  const started = startConversation(sessionKey, true);

  return res.status(200).json({
    ok: true,
    sessionId: sessionKey.replace(/^web:/, ""),
    ...started,
  });
});

app.post("/webchat/message", async (req, res) => {
  const { sessionId, message } = req.body || {};

  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Provide 'sessionId' from /webchat/start.",
    });
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      ok: false,
      error: "Provide a non-empty 'message'.",
    });
  }

  const result = await processConversationAnswer(`web:${sessionId}`, message);
  if (!result.ok) {
    return res.status(result.statusCode).json(result.payload);
  }

  return res.status(200).json({
    sessionId,
    ...result.payload,
  });
});

app.post("/webhook/message", async (req, res) => {
  const { phone } = req.body;
  const incomingText = pickInputText(req.body);

  if (!incomingText || !phone) {
    return res.status(400).json({
      ok: false,
      error:
        "Provide 'phone' and at least one of: 'message', 'text', 'transcript', 'speech', 'speechText', or 'voiceText'.",
    });
  }

  if (isTriggerMessage(incomingText)) {
    const linkReply = `${WHATSAPP_LINK_MESSAGE}\n${WEBCHAT_FORM_LINK}`;
    const response = await safeReply(phone, linkReply);
    return res.status(200).json({
      ok: true,
      triggered: true,
      stage: "web_link_sent",
      webchatLink: WEBCHAT_FORM_LINK,
      ...response,
    });
  }

  const sessionKey = `wa:${phone}`;
  const existingSession = sessions.get(sessionKey);

  if (!existingSession) {
    return res.status(200).json({
      ok: true,
      triggered: false,
      info: "Input text does not match trigger phrase.",
    });
  }

  const result = await processConversationAnswer(sessionKey, incomingText);
  if (!result.ok) {
    return res.status(result.statusCode).json(result.payload);
  }

  const response = await safeReply(phone, result.payload.reply);

  return res.status(200).json({
    ...result.payload,
    ...response,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

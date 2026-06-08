import { GoogleGenerativeAI } from "@google/generative-ai";

export const KEYWORD_FALLBACK_MAP: Record<string, Record<string, string>> = {
  "chaufför": {
    sv: "chaufför",
    no: "sjåfør",
    da: "chaufför",
    fi: "kuljettaja",
    en: "driver"
  },
  "chauffør, ce, lastbil": {
    sv: "chaufför, ce, lastbil",
    no: "sjåfør, ce, lastebil",
    da: "chauffør, ce, lastbil",
    fi: "kuljettaja, ce, kuorma-auto",
    en: "driver, ce, truck"
  },
  "lastbil": {
    sv: "lastbil",
    no: "lastebil",
    da: "lastbil",
    fi: "kuorma-auto",
    en: "truck"
  },
  "lager": {
    sv: "lager",
    no: "lager",
    da: "lager",
    fi: "varasto",
    en: "warehouse"
  }
};

/**
 * Translates search keywords from Swedish/English into the target language of the respective country's API.
 */
export async function translateKeyword(
  keyword: string,
  targetLang: "sv" | "no" | "da" | "fi" | "en"
): Promise<string> {
  const cleanKeyword = keyword.trim().toLowerCase();
  
  if (!cleanKeyword) return "";

  // 1. Try static mapping first for common terms to bypass API latency
  if (KEYWORD_FALLBACK_MAP[cleanKeyword]?.[targetLang]) {
    return KEYWORD_FALLBACK_MAP[cleanKeyword]![targetLang]!;
  }

  // 2. Check for Gemini API key to translate dynamically
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return keyword; // fallback to original
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: `Translate the job search keyword/phrase from Swedish/English into the target language: "${targetLang}". Return ONLY the translation, no extra text, explanations, or quotes. If there are multiple words, translate them all.`,
    });

    const result = await model.generateContent(`Translate: "${keyword}"`);
    const translated = result.response.text().trim();
    return translated || keyword;
  } catch (err) {
    console.warn(`[translateKeyword] Translation failed for "${keyword}" to ${targetLang}:`, err);
    return keyword;
  }
}

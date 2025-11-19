import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const MODEL_NAME = 'gemini-2.5-flash';

export const generateCategories = async (level: number): Promise<string[]> => {
  try {
    const prompt = `Generate 4 distinct and interesting trivia categories for Level ${level} of a quiz game. 
    Examples: 'Geography', '90s Music', 'Quantum Physics', 'Memes'. 
    Return strictly a JSON array of strings. Language: Russian.`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Error generating categories:", error);
    return ["Наука", "История", "Кино", "Спорт"]; // Fallback
  }
};

export const generateQuestions = async (category: string, count: number, isBlitz: boolean = false): Promise<Question[]> => {
  try {
    const prompt = isBlitz 
      ? `Generate ${count} random trivia questions from VARIOUS categories for a final blitz round. Language: Russian.` 
      : `Generate ${count} trivia questions for the category: "${category}". Language: Russian.`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: "The question text" },
              options: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Array of 4 possible answers" 
              },
              correctIndex: { type: Type.INTEGER, description: "Index (0-3) of the correct answer" },
              category: { type: Type.STRING, description: "Category name" },
              explanation: { type: Type.STRING, description: "Short fact explaining the answer" }
            },
            required: ["text", "options", "correctIndex", "category"]
          }
        }
      }
    });

    const questions = JSON.parse(response.text || "[]") as Question[];
    return questions;
  } catch (error) {
    console.error("Error generating questions:", error);
    // Fallback question to prevent crash
    return Array(count).fill({
      text: "Ошибка генерации вопросов. Попробуйте перезапустить.",
      options: ["Ок", "Ладно", "Хорошо", "Понятно"],
      correctIndex: 0,
      category: "Error",
      explanation: "AI service temporarily unavailable."
    });
  }
};
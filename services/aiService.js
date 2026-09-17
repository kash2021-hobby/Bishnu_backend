const axios = require('axios');
require('dotenv').config();

/**
 * Generate structured Task Form & Subtasks using AI (Gemini API)
 * @param {string} promptText
 * @returns {Object}
 */
async function generateTaskFormWithAI(promptText) {
  if (!promptText) return null;

  const apiKey = process.env.GEMINI_API_KEY;

  const systemInstruction = `You are an AI Task Management Assistant. Analyze the user prompt and extract structured task attributes in valid JSON format.
Expected JSON Schema:
{
  "MainHeading": "Documentation" | "Operations" | "Marketing" | "Revenue" | "Tech",
  "Title": "Short, clear task title",
  "Description": "Detailed operational instructions",
  "BusinessEntity": "Company",
  "Department": "Marketing" | "Sales" | "Operations" | "Technical" | "Accounting",
  "Priority": "Low" | "Medium" | "High" | "Urgent",
  "DaysAllowed": 3,
  "EstimatedBudget": 500,
  "Subtasks": [
    { "Title": "Subtask title 1", "Department": "Marketing" },
    { "Title": "Subtask title 2", "Department": "Technical" }
  ]
}
Return ONLY valid raw JSON. No markdown code blocks.`;

  // Fallback Rule-Based Parser if API key is mock or unavailable
  if (!apiKey || apiKey.startsWith('AIzaSy_Mock')) {
    const isMarketing = /market|ad|copy|design|facebook|campaign/i.test(promptText);
    const isTech = /code|dev|tech|bug|fix|api|server|web/i.test(promptText);
    const isSales = /sales|deal|client|revenue|pitch/i.test(promptText);

    let dept = 'Operations';
    let heading = 'Operations';
    if (isMarketing) { dept = 'Marketing'; heading = 'Marketing'; }
    if (isTech) { dept = 'Technical'; heading = 'Tech'; }
    if (isSales) { dept = 'Sales'; heading = 'Revenue'; }

    return {
      MainHeading: heading,
      Title: promptText.length > 50 ? promptText.substring(0, 50) + '...' : promptText,
      Description: 'AI-generated task task based on prompt: ' + promptText,
      BusinessEntity: '',
      Department: dept,
      Priority: /urgent|asap|critical/i.test(promptText) ? 'Urgent' : 'Medium',
      DaysAllowed: 5,
      EstimatedBudget: 1500,
      Subtasks: [
        { Title: '1. Prepare initial requirements & documentation', Department: dept },
        { Title: '2. Execute primary action items & review', Department: dept },
        { Title: '3. Verify deployment & notify team', Department: dept }
      ]
    };
  }

  try {
    const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      contents: [{ parts: [{ text: systemInstruction + '\nUser Prompt: ' + promptText }] }]
    });

    const candidate = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidate) {
      const cleanJson = candidate.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    }
  } catch (err) {
    console.error('[AI Service] Gemini API call error:', err.message);
  }

  return {
    MainHeading: 'Operations',
    Title: promptText,
    Description: promptText,
    BusinessEntity: 'Company X (Shared)',
    Department: 'Operations',
    Priority: 'Medium',
    DaysAllowed: 3,
    Subtasks: []
  };
}

module.exports = {
  generateTaskFormWithAI
};

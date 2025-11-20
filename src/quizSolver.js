// src/quizSolver.js
const axios = require('axios');
const { chromium } = require('playwright');
const OpenAI = require('openai');

// Initialize OpenAI client (expects OPENAI_API_KEY in env)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Model name you wanted
const MODEL_NAME = 'gpt-5-nano-2025-08-07';

/**
 * Main quiz chain runner.
 * - Uses Playwright to load quiz pages (JS executes).
 * - Extracts text + <pre>.
 * - Builds a payload and submits an answer (computed via OpenAI).
 * - Follows new URLs until done or timeout.
 */
async function solveQuizChain({ startUrl, email, secret, deadline }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let currentUrl = startUrl;
  let lastResult = null;

  try {
    while (Date.now() < deadline) {
      console.log('Visiting quiz URL:', currentUrl);

      // 1. Go to quiz page and let JS run
      await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 60000 });

      // 2. Extract visible text and any <pre> blocks
      const bodyText = await page.textContent('body').catch(() => '');
      const preTexts = await page.$$eval('pre', nodes =>
        nodes.map(n => n.textContent || '')
      );

      console.log('Body text (first 200 chars):');
      console.log((bodyText || '').slice(0, 200));

      // 3. Try to parse JSON from the first <pre> block as an example payload
      const { templatePayload, submitUrlFromTemplate } =
        parseTemplateFromPre(preTexts[0] || '');

      // 4. Compute the answer using OpenAI
      const answer = await computeAnswer({
        page,
        bodyText,
        preTexts,
        templatePayload
      });

      // 5. Build the payload to submit
      const payload = {
        ...(templatePayload || {}),
        email,
        secret,
        url: (templatePayload && templatePayload.url) || currentUrl,
        answer
      };

      // 6. Decide where to POST the answer
      const submitUrl = pickSubmitUrl(bodyText, submitUrlFromTemplate, currentUrl);

      console.log('Submitting answer to:', submitUrl);
      console.log('Answer value:', answer);

      const response = await axios.post(submitUrl, payload, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });

      lastResult = response.data;
      console.log('Submit response:', lastResult);

      // If no new URL is given, we are done
      if (!lastResult || !lastResult.url) {
        break;
      }

      // Otherwise follow the next quiz URL
      currentUrl = lastResult.url;
    }
  } catch (e) {
    console.error('Error in solveQuizChain:', e);
    return {
      status: 'error',
      message: 'Error while solving quiz chain',
      error: e.message,
      lastResult
    };
  } finally {
    await browser.close();
  }

  if (!lastResult) {
    return {
      status: 'no_response',
      message: 'No response received from quiz server before deadline',
      startUrl
    };
  }

  return {
    status: 'completed_playwright_llm',
    message:
      'Playwright chain executed with OpenAI-based computeAnswer. Behaviour depends on quiz instructions.',
    lastResult
  };
}

/**
 * Try to parse JSON from a <pre> block like:
 * {
 *   "email": "your email",
 *   "secret": "your secret",
 *   "url": "https://example.com/quiz-834",
 *   "answer": 12345
 * }
 */
function parseTemplateFromPre(preText) {
  if (!preText) {
    return { templatePayload: null, submitUrlFromTemplate: null };
  }

  const firstBrace = preText.indexOf('{');
  const lastBrace = preText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return { templatePayload: null, submitUrlFromTemplate: null };
  }

  const jsonCandidate = preText.slice(firstBrace, lastBrace + 1);

  try {
    const obj = JSON.parse(jsonCandidate);
    return { templatePayload: obj, submitUrlFromTemplate: null };
  } catch (e) {
    console.warn('Failed to parse JSON from <pre> block:', e.message);
    return { templatePayload: null, submitUrlFromTemplate: null };
  }
}

/**
 * Attempt to determine the submit URL.
 * Priority:
 *  1. submitUrlFromTemplate (if we ever set it)
 *  2. a URL in the body text that appears after "Post your answer to"
 *  3. fallback to current quiz URL
 */
function pickSubmitUrl(bodyText, submitUrlFromTemplate, fallbackUrl) {
  if (submitUrlFromTemplate) return submitUrlFromTemplate;

  if (bodyText) {
    const regex = /Post your answer to\s+(https?:\/\/[^\s"']+)/i;
    const match = bodyText.match(regex);
    if (match && match[1]) {
      return match[1];
    }
  }

  return fallbackUrl;
}

/**
 * computeAnswer: uses OpenAI (gpt-5-nano-2025-08-07) to infer the answer
 * from the quiz page text and example payload.
 *
 * - Sends bodyText and templatePayload to the model.
 * - Instructs the model to output ONLY the final answer.
 * - If the output is numeric, returns a Number; otherwise returns the raw string/boolean.
 */
async function computeAnswer({ page, bodyText, preTexts, templatePayload }) {
  console.log('--- computeAnswer() LLM ---');

  const contextSnippet = (bodyText || '').slice(0, 6000);
  const templateJson = templatePayload ? JSON.stringify(templatePayload, null, 2) : 'None';

  const userPrompt = `
You are an assistant inside an automated quiz solver.
You are given the visible text of a quiz web page and, if available,
an example JSON payload used to submit the answer.

Your job is to determine the correct value for the "answer" field in that JSON.

Instructions:
- Read the question carefully.
- Perform any reasoning or calculations needed.
- DO NOT explain your reasoning.
- Reply with ONLY the final answer value:
  - If it is a number, reply with just the number (e.g., 12345).
  - If it is a string, reply with just the string, no quotes.
  - If it should be boolean, reply with true or false.
- Do not include any extra text.

Page text:
-----
${contextSnippet}
-----

Example payload (may be from <pre> on page):
-----
${templateJson}
-----
  `.trim();

  const response = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      {
        role: 'system',
        content:
          'You are a precise function that outputs ONLY the final answer value with no explanation.'
      },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0
  });

  const raw = (response.choices[0].message.content || '').trim();
  console.log('LLM raw answer:', raw);

  // Try to interpret as boolean if possible
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;

  // Try to interpret as a number
  const num = Number(raw);
  if (!Number.isNaN(num)) {
    return num;
  }

  // Otherwise return as string
  return raw;
}

module.exports = {
  solveQuizChain
};


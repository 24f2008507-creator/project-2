// src/index.js
const express = require('express');
const { solveQuizChain } = require('./quizSolver');

const app = express();
const PORT = process.env.PORT || 8000;

// Use env var if set, otherwise fallback to the hard-coded secret
const APP_SECRET = process.env.TDS_SECRET || 'tds24_llm_quiz_7JxQ29';

// --- Middleware to parse JSON and handle invalid JSON ---
app.use(express.json());

// Error handler for JSON parse errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next();
});

// --- /quiz endpoint (main handler for TDS) ---
app.post('/quiz', async (req, res) => {
  try {
    const { email, secret, url } = req.body || {};

    if (!email || !secret || !url) {
      return res.status(400).json({
        error: 'Invalid fields. "email", "secret", and "url" are required.'
      });
    }

    if (secret !== APP_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const deadline = Date.now() + 3 * 60 * 1000; // 3 minutes
    const result = await solveQuizChain({ startUrl: url, email, secret, deadline });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Unexpected error in /quiz handler:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- /demo endpoint (alias for /quiz, used in evaluation) ---
app.post('/demo', async (req, res) => {
  try {
    console.log('Incoming request to /demo:', req.body);

    const { email, secret, url } = req.body || {};

    if (!email || !secret || !url) {
      return res.status(400).json({
        error: 'Invalid fields. "email", "secret", and "url" are required.'
      });
    }

    if (secret !== APP_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const deadline = Date.now() + 3 * 60 * 1000; // 3 minutes

    // You can test basic functionality without Playwright by returning OK
    // const result = { status: 'ok', message: 'Demo endpoint active', received: { email, url } };

    // Or use the full solver:
    const result = await solveQuizChain({ startUrl: url, email, secret, deadline });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Unexpected error in /demo handler:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Health check endpoint (optional) ---
app.get('/', (req, res) => {
  res.status(200).send('TDS LLM Quiz Solver is running.');
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`TDS quiz server listening on port ${PORT}`);
});

// src/index.js
const express = require('express');
const { solveQuizChain } = require('./quizSolver');

const app = express();
const PORT = process.env.PORT || 8000;

// Use env var if set, otherwise fallback to the hard-coded secret
const APP_SECRET = process.env.TDS_SECRET || 'tds24_llm_quiz_7JxQ29';

// --- Middleware to parse JSON and handle invalid JSON ---

app.use(express.json());

// Error handler specifically for JSON parse errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next();
});

// --- Main /quiz endpoint ---

app.post('/quiz', async (req, res) => {
  try {
    const body = req.body || {};
    const { email, secret, url } = body;

    // 1. Check required fields
    if (!email || !secret || !url) {
      return res.status(400).json({
        error: 'Invalid fields. "email", "secret", and "url" are required.'
      });
    }

    // 2. Validate secret
    if (secret !== APP_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    // 3. Secret is valid → solve quiz chain within 3 minutes
    const deadline = Date.now() + 3 * 60 * 1000; // now + 3 minutes

    const result = await solveQuizChain({
      startUrl: url,
      email,
      secret,
      deadline
    });

    // HTTP 200 is required for valid secrets
    return res.status(200).json(result);
  } catch (err) {
    console.error('Unexpected error in /quiz handler:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
// --- /demo endpoint (alias for the main quiz solver) ---
app.post('/demo', async (req, res) => {
  try {
    const body = req.body || {};
    const { email, secret, url } = body;

    if (!email || !secret || !url) {
      return res.status(400).json({
        error: 'Invalid fields. "email", "secret", and "url" are required.'
      });
    }

    if (secret !== APP_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const deadline = Date.now() + 3 * 60 * 1000;
    const result = await solveQuizChain({ startUrl: url, email, secret, deadline });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Unexpected error in /demo handler:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// --- Start server ---

app.listen(PORT, () => {
  console.log(`TDS quiz server listening on port ${PORT}`);
});


# TDS LLM Quiz 2025 – Node.js Endpoint

Node + Express + Playwright + OpenAI endpoint for the IITM TDS LLM quiz.

## Endpoint

- `POST /quiz`

Request body:

```json
{
  "email": "your email",
  "secret": "your secret",
  "url": "https://example.com/quiz-834"
}


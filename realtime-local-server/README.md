# HMP Realtime Local Server

Local development server for creating short-lived OpenAI Realtime client secrets.

This server keeps the permanent OpenAI API key out of browser JavaScript. The future production backend can replace this endpoint with the same frontend contract.

## Setup

```bash
cd realtime-local-server
npm install
```

Create a local `.env` file:

```bash
OPENAI_API_KEY=your_openai_project_api_key_here
PORT=3001
```

Do not commit `.env`.

## Run

```bash
npm start
```

The server listens on `http://localhost:3001` by default.

## Endpoint

```http
POST /api/realtime/session
Content-Type: application/json
```

Request body:

```json
{}
```

Successful response shape:

```json
{
  "clientSecret": "ek_...",
  "expiresAt": 1756310470,
  "model": "gpt-realtime",
  "session": {
    "type": "realtime",
    "object": "realtime.session",
    "model": "gpt-realtime"
  }
}
```

The `clientSecret` is temporary and is safe to return to the browser. The permanent `OPENAI_API_KEY` must remain only in `.env` on the server.

## Manual Test

```bash
curl -X POST http://localhost:3001/api/realtime/session ^
  -H "Content-Type: application/json" ^
  -d "{}"
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:3001/api/realtime/session `
  -ContentType 'application/json' `
  -Body '{}'
```

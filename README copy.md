# Document Link Trigger API

This API checks incoming text or speech transcripts.  
If input contains the trigger phrase (`I am sending you the document link`), it sends a WhatsApp message with your document collection form link.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file from the example:

```bash
cp .env.example .env
```

3. Update `.env` values:

- `DOCUMENT_FORM_LINK`: Your form URL where users upload documents.
- `WHATSAPP_PHONE_NUMBER_ID`: Meta WhatsApp phone number ID.
- `WHATSAPP_ACCESS_TOKEN`: Meta WhatsApp API access token.

## Run

```bash
npm start
```

Server starts on `http://localhost:3000` (or your `PORT`).

## API Endpoints

### Health

`GET /health`

### Message Webhook

`POST /webhook/message`

Request body (text input):

```json
{
  "message": "I am sending you the document link",
  "phone": "919999999999"
}
```

Request body (speech input):

```json
{
  "transcript": "I am sending you the document link",
  "phone": "919999999999"
}
```

Behavior:

- It checks first non-empty field from: `message`, `text`, `transcript`, `speech`, `speechText`, `voiceText`.
- If input contains trigger phrase, API sends WhatsApp text with form link.
- Otherwise it returns `triggered: false`.

## Notes

- Phone number should be in international format (without `+`).
- If WhatsApp credentials are missing, API responds but marks message as not sent with reason.

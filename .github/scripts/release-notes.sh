#!/usr/bin/env bash
set -e -E

if [ -z "$GEMINI_API_KEY" ]; then
  echo "GEMINI_API_KEY is not set"
  exit 1
fi

MODEL_ID="gemini-3.1-flash-lite"
GENERATE_CONTENT_API="generateContent"

if [ -z "$PREVIOUS_TAG" ]; then
  COMMITS=$(git log --no-merges --pretty=format:'%s%n%b')
else
  COMMITS=$(git log "${PREVIOUS_TAG}..HEAD" --no-merges --pretty=format:'%s%n%b')
fi

if [ -z "$COMMITS" ]; then
  echo "Initial release."
  exit 0
fi

PROMPT="You are a release assistant that summarizes Git commit histories into clear, human-readable release notes.

Guidelines:
- Write the first line as a succinct one-sentence title (for example, 'Adds retry logic and job fix'), then include a blank line followed by formatted release notes.
- Group related changes together under headers (✨ Features, 🐛 Fixes, 🧹 Maintenance).
- Ignore trivial commits like version bumps or formatting.
- Be concise and professional (5–10 short bullet points max).
- Do not include commit hashes, author names, or dates.
- Do not include any other detail than the summary (e.g., no 'here's the summary'). The only output should be
  the markdown that will be used as the tag comment.

Now summarize the following commit history:
---
$COMMITS
---"

RESPONSE=$(jq -n --arg text "$PROMPT" '{
  contents: [{role: "user", parts: [{text: $text}]}],
  generationConfig: {temperature: 0.7}
}' | curl -s -X POST \
  -H "Content-Type: application/json" \
  "https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}" \
  -d @-)

if ! echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
  echo "Invalid JSON response from Gemini API:" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

SUMMARY=$(echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].text // empty')

if [ -z "$SUMMARY" ]; then
  echo "No summary returned. Full response:" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo "$SUMMARY"

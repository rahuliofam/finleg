# Translation Prompt for Gemini

## Instructions

I need you to translate a JSON file containing English content for a community organization website into multiple languages. The output should be a single JSON file containing all languages (including the original English).

## Target Languages

Customize this list based on the languages your organization needs. Example:

1. **en** — English (keep as-is from the source)
2. **es** — Spanish (Español)
3. **fr** — French (Français)

## Translation Guidelines

1. **DO NOT translate** proper nouns and names. Keep these in their original form:
   - Organization names, people's names, place names
   - Brand names: "AlpacApps", "Claude", "Google Pay", "PayPal"
   - Technical terms: "UPI", "SWIFT", "IFSC"
   - Country names should be translated to their local equivalents in each language

2. **Preserve JSON structure exactly** — same keys, same nesting. Only translate the string values.

3. **Keep placeholder tokens** like `{amount}`, `{currency}`, `{frequency}`, `{name}` exactly as they are in the translated strings.

4. **Tone**: Match the tone appropriate for your organization — professional, warm, formal, or casual as needed.

5. **For all languages**: Keep translations natural and fluent, not word-for-word. Adapt idioms and expressions to feel native in each language.

## Output Format

Return a single JSON file structured as:

```json
{
  "en": { ... entire English content ... },
  "es": { ... entire Spanish translation ... },
  "fr": { ... entire French translation ... }
}
```

## Source Content (English)

Paste the contents of `en.json` below this line, then send to Gemini:

---

```json
{paste the contents of translations/en.json here}
```

# Lathala

An AI-powered aggregator news app.

## Structure

```text
public/
  index.html                    # Static public website
  static/                       # Public CSS, JS, images, and UI assets

admin/
  app.py                        # Local-only Flask control app
  main.py                       # Production scrape/summarize pipeline
  lathala/                      # Scraper, Gemini, repository, and pipeline code
  static/                       # Control CSS, JS, images, and UI assets
  requirements.txt

schema.sql                      # Supabase SQL file
```

## Secrets and Config

| Secret                      | Required | Description                  |
| --------------------------- | -------: | ---------------------------- |
| `GEMINI_API_KEY`            |      Yes | Gemini API key for scraping. |
| `SUPABASE_URL`              |      Yes | Supabase project URL.        |
| `SUPABASE_SERVICE_ROLE_KEY` |      Yes | Supabase service role key.   |

## Dependencies

```bash
pip install -r admin/requirements.txt
playwright install webkit
```

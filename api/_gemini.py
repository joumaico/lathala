import os
import time

from google.genai import Client


def flash(prompt: str) -> str:
    while True:
        try:
            client = Client(api_key=os.getenv("GEMINI_API_KEY"))
            response = client.models.generate_content(
                model="gemini-3.1-flash-lite-preview",
                contents={"text": prompt},
            )
            return response.text
        except:
            time.sleep(5)

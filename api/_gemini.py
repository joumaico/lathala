import os
import time

from google.genai import Client


def flash(prompt: str) -> str:
    while True:
        try:
            print(f"Loading...")
            client = Client(api_key=os.getenv("GEMINI_API_KEY"))
            response = client.models.generate_content(
                model="gemini-3.1-flash-lite-preview",
                contents={"text": prompt},
            )
            return response.text
        except Exception as e:
            print(e)
            print("Failed... Refetching...")
            time.sleep(5)
        finally:
            time.sleep(15)  # to avoid rate limit

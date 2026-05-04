from ._gemini import flash
from ._supabase import open_supabase_client
from ._webkit import process_urls as webkit

supabase = open_supabase_client()

__all__ = [
    "flash",
    "supabase",
    "webkit",
]
